// 云函数 ballAdd
// 职责：约球帖子（ball_posts）相关操作
// 调用方式：wx.cloud.callFunction({ name: 'ballAdd', data: { type, payload } })
//  type 取值：
//    'add'         新增帖子
//    'list'        帖子列表（按 createdAt 倒序）
//    'detail'      帖子详情
//    'apply'       申请入队
//    'cancelApply' 取消入队
//    'close'       关闭招募（仅创建者）
//    'confirmComplete' 确认完成（满员后创建者确认，状态→completed，广场不再展示）
//    'delete'      删除帖子（仅创建者）
//    'myPosts'     我发起的约球
//    'myJoined'    我加入的约球（joinedUsers.openid 查询）
//
// 提醒联动（与 cloudfunctions/ballReminder 协作）：
//   - close    : 取消该 post 下所有 pending 提醒
//   - delete   : 取消该 post 下所有 pending 提醒
//   - cancelApply : 取消自己对该 post 的 pending 提醒
//
// 权限约定：
//   1. 所有写操作（add/apply/cancelApply/close/delete）必须先取 OPENID
//   2. add：openid 通过 cloud.getWXContext().OPENID 自动获取，无需前端传入
//   3. apply / cancelApply：自动取当前 openid，不信任前端传入
//   4. close / delete：仅 _openid 等于创建者的请求会被处理
//   5. 任何报错统一返回 { success: false, errCode, errMsg }

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COL = 'ball_posts';
// 提醒集合：与 cloudfunctions/ballReminder/index.js 中的 REM_COL 保持一致
const REM_COL = 'ball_reminders';

// 工具：取当前用户 openid
const getOpenId = () => {
  const wxContext = cloud.getWXContext();
  return wxContext.OPENID || '';
};

// 工具：统一返回结构
const ok = (data = null) => ({ success: true, data });
const fail = (errCode, errMsg) => ({ success: false, errCode, errMsg });

// 工具：确保集合存在（避免 -502005 "Db or Table not exist"）
// 兜底：任何其他错误都吞掉 + 打日志，不让 ensureCollection 自身把云函数打死
const ensureCollection = async (name) => {
  try {
    await db.createCollection(name);
    console.log(`[ballAdd] 已自动创建集合 ${name}`);
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || '';
    if (e && (e.errCode === -501001 || /already exist/i.test(msg))) {
      return;
    }
    console.error(`[ballAdd] ensureCollection(${name}) 失败（忽略，继续）:`, msg);
  }
};

// 工具：把 postId 下所有 pending 提醒置为 cancelled
// 兜底：ball_reminders 集合不存在时不抛错，不让提醒表把主流程打死
const cancelRemindersByPost = async (postId) => {
  try {
    await ensureCollection(REM_COL);
    const res = await db.collection(REM_COL)
      .where({ postId, status: 'pending' })
      .limit(100)
      .get();
    const list = res.data || [];
    const now = Date.now();
    for (const doc of list) {
      await db.collection(REM_COL).doc(doc._id).update({
        data: { status: 'cancelled', updatedAt: now, failReason: 'POST_CLOSED' }
      });
    }
    return list.length;
  } catch (e) {
    console.error('[ballAdd] cancelRemindersByPost error', e);
    return 0;
  }
};

// 工具：把 (postId, openid) 的 pending 提醒置为 cancelled
const cancelOwnReminder = async (postId, openid) => {
  try {
    await ensureCollection(REM_COL);
    const res = await db.collection(REM_COL)
      .where({ postId, recipientOpenid: openid, status: 'pending' })
      .limit(10)
      .get();
    const list = res.data || [];
    const now = Date.now();
    for (const doc of list) {
      await db.collection(REM_COL).doc(doc._id).update({
        data: { status: 'cancelled', updatedAt: now, failReason: 'USER_CANCEL_APPLY' }
      });
    }
    return list.length;
  } catch (e) {
    console.error('[ballAdd] cancelOwnReminder error', e);
    return 0;
  }
};

// 工具：算出 effectiveStatus（用于 list/detail/apply）
//   - 存储的 status 为 'closed' → 直接是 'closed'（创建者手动关闭）
//   - 存储的 status 为 'completed' → 直接是 'completed'（创建者确认满员）
//   - 否则若 recruitDeadline 已过 → 'expired'（自动到期）
//   - 否则维持原 status
// 同时给 post 加 isExpired / secondsLeft 字段，方便前端展示
const withEffectiveStatus = (post, now = Date.now()) => {
  let effective = post.status || 'open';
  let isExpired = false;
  let secondsLeft = 0;
  if (post.status === 'open' && post.recruitDeadline && now > post.recruitDeadline) {
    effective = 'expired';
    isExpired = true;
  } else if (post.recruitDeadline && post.status === 'open') {
    secondsLeft = Math.max(0, Math.floor((post.recruitDeadline - now) / 1000));
  }
  return { ...post, effectiveStatus: effective, isExpired, secondsLeft };
};

// ====== 1. 新增帖子 ======
const addPost = async (event) => {
  const p = event.payload || {};
  // 1) 字段校验
  const required = ['sport', 'time', 'location', 'needCount'];
  for (const k of required) {
    if (p[k] === undefined || p[k] === '' || p[k] === null) {
      return fail('INVALID_PARAM', `字段 ${k} 不能为空`);
    }
  }
  if (Number(p.needCount) < 1 || Number(p.needCount) > 20) {
    return fail('INVALID_PARAM', 'needCount 必须在 1~20 之间');
  }
  const validSports = ['tennis', 'basketball', 'badminton', 'football', 'pingpong', 'volleyball'];
  if (!validSports.includes(p.sport)) {
    return fail('INVALID_PARAM', '不支持的运动项目');
  }
  const validScope = ['all', 'college', 'grade'];
  if (p.scope && !validScope.includes(p.scope)) {
    return fail('INVALID_PARAM', '不支持的招募范围');
  }

  // 2) 写入
  try {
    await ensureCollection(COL);
    const now = Date.now();
    // recruitDeadline 可选：用户填了才校验；必须是未来的时间戳
    let recruitDeadline = 0;
    if (p.recruitDeadline) {
      const t = Number(p.recruitDeadline);
      if (!Number.isFinite(t) || t <= 0) {
        return fail('INVALID_PARAM', '招募截止时间格式不正确');
      }
      if (t <= now) {
        return fail('INVALID_PARAM', '招募截止时间必须在未来');
      }
      // 不能超过 30 天
      if (t - now > 30 * 24 * 3600 * 1000) {
        return fail('INVALID_PARAM', '招募截止时间不能超过 30 天');
      }
      recruitDeadline = t;
    }

    const res = await db.collection(COL).add({
      data: {
        sport: p.sport,
        time: p.time,
        location: String(p.location).slice(0, 100),
        needCount: Number(p.needCount),
        currentCount: 1,             // 创建者算 1 人
        scope: p.scope || 'all',
        contact: String(p.contact || '').slice(0, 50),
        remark: String(p.remark || '').slice(0, 200),
        nickName: String(p.nickName || '拾球记用户').slice(0, 30),
        avatarUrl: String(p.avatarUrl || ''),
        joinedUsers: [],            // 申请入队的成员
        status: 'open',             // open / closed（DB 状态，到期后不改 DB）
        recruitDeadline,            // 0 = 不自动截止；>0 = 到点自动视为 closed
        createdAt: now,
        updatedAt: now
      }
    });
    return ok({ _id: res._id });
  } catch (e) {
    console.error('[ballAdd] addPost error', e);
    return fail('DB_ERROR', e.message || '数据库写入失败');
  }
};

// ====== 2. 列表 ======
// 排序规则：
//   1) 还在招的（open 且 currentCount < needCount）排前面
//   2) 已结束的（满员 currentCount >= needCount，或创建者主动 status='closed'）排最后
//   3) 同组内按 createdAt 降序
// 过滤规则：
//   - recruitDeadline 已过的帖子（expired）广场不展示
//   - status='completed'（创建者已确认完成）广场不展示 —— 创建者/参与者仍能在我的页面看到
//   - 过期帖仍保留在 DB，创建者自己可在 myPosts 里看到（已按 _openid 过滤）
// 实现：先多拉一些到内存里过滤+排序，再分页
//   （微信云 DB 不支持多 key 排序，内存排序是常规做法）
const listPosts = async (event) => {
  const pageSize = Math.min(Number(event.pageSize) || 20, 50);
  const skip = Math.max(Number(event.skip) || 0, 0);
  try {
    await ensureCollection(COL);
    // 拉取上限 200 条，对个人小程序足够；超过这个量建议改用聚合 pipeline
    const res = await db.collection(COL)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    const now = Date.now();
    // 1) 过滤掉已过期的帖子：广场不展示（创建者自己仍能在 myPosts 看到）
    //    关键：status='completed' 也过滤 —— 用户明确说"已完成"的不再上广场
    const visible = (res.data || []).filter((p) => {
      if (p.recruitDeadline && now > p.recruitDeadline) return false;
      if (p.status === 'completed') return false;
      return true;
    });
    // 2) 排序：还在招的排前，已结束的排后；同组内按 createdAt 降序
    //    "还在招" = status 不为 closed 且 currentCount < needCount
    //    "已结束" = status === 'closed' 或 currentCount >= needCount
    visible.sort((a, b) => {
      const aActive = a.status !== 'closed' && a.status !== 'completed' && (a.currentCount || 0) < (a.needCount || 0);
      const bActive = b.status !== 'closed' && b.status !== 'completed' && (b.currentCount || 0) < (b.needCount || 0);
      if (aActive !== bActive) return aActive ? -1 : 1; // 还在招的排前
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    // 3) 关键：给每条加 effectiveStatus / isExpired / secondsLeft 后分页返回
    const enriched = visible.slice(skip, skip + pageSize).map((p) => withEffectiveStatus(p, now));
    return ok({
      list: enriched,
      total: visible.length,
      skip,
      pageSize
    });
  } catch (e) {
    console.error('[ballAdd] listPosts error', e);
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ====== 3. 详情 ======
// 权限：expired 帖（recruitDeadline 已过）只对创建者本人可见，其他人返回 NOT_FOUND
// 理由：广场里已过滤掉过期帖，不应让直接持 ID 的人绕过列表看到
const detailPost = async (event) => {
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 不能为空');
  try {
    await ensureCollection(COL);
    const res = await db.collection(COL).doc(id).get();
    if (!res.data) return fail('NOT_FOUND', '帖子不存在');
    const post = res.data;
    // 关键：过期的帖子，只有 _openid 等于当前用户才返回，否则 404
    if (post.recruitDeadline && Date.now() > post.recruitDeadline) {
      const openid = getOpenId();
      if (post._openid !== openid) {
        return fail('NOT_FOUND', '帖子不存在');
      }
    }
    return ok(withEffectiveStatus(post));
  } catch (e) {
    console.error('[ballAdd] detailPost error', e);
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ====== 4. 申请入队 ======
const applyPost = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  const { id, nickName, avatarUrl } = event;
  if (!id) return fail('INVALID_PARAM', 'id 不能为空');

  try {
    // 读取帖子，判断状态
    await ensureCollection(COL);
    const postRes = await db.collection(COL).doc(id).get();
    const post = postRes.data;
    if (!post) return fail('NOT_FOUND', '帖子不存在');
    if (post._openid === openid) return fail('OWN_POST', '不能申请加入自己发起的约球');
    // 关键：到 recruitDeadline 后不能再申请
    if (post.status === 'open' && post.recruitDeadline && Date.now() > post.recruitDeadline) {
      return fail('EXPIRED', '招募已截止');
    }
    if (post.status === 'completed') return fail('COMPLETED', '该约球已完成招募');
    if (post.status !== 'open') return fail('CLOSED', '该帖已关闭招募');
    if (post.currentCount >= post.needCount) return fail('FULL', '人数已满');
    // 防止重复申请
    const joined = post.joinedUsers || [];
    if (joined.some((u) => u.openid === openid)) {
      return fail('DUPLICATE', '你已申请过该帖');
    }

    const joinedUser = {
      openid,
      nickName: String(nickName || '拾球记用户').slice(0, 30),
      avatarUrl: String(avatarUrl || ''),
      joinedAt: Date.now()
    };

    await db.collection(COL).doc(id).update({
      data: {
        joinedUsers: _.push([joinedUser]),
        currentCount: _.inc(1),
        updatedAt: Date.now()
      }
    });

    return ok({ id });
  } catch (e) {
    console.error('[ballAdd] applyPost error', e);
    return fail('DB_ERROR', e.message || '申请失败');
  }
};

// ====== 5. 取消入队 ======
const cancelApply = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 不能为空');

  try {
    await ensureCollection(COL);
    const postRes = await db.collection(COL).doc(id).get();
    const post = postRes.data;
    if (!post) return fail('NOT_FOUND', '帖子不存在');
    const joined = post.joinedUsers || [];
    const target = joined.find((u) => u.openid === openid);
    if (!target) return fail('NOT_JOINED', '你尚未加入该帖');

    await db.collection(COL).doc(id).update({
      data: {
        joinedUsers: _.pull({ openid }),
        currentCount: _.inc(-1),
        updatedAt: Date.now()
      }
    });
    // 取消入队：同时取消当前用户在该 post 上的 pending 提醒
    await cancelOwnReminder(id, openid);
    return ok({ id });
  } catch (e) {
    console.error('[ballAdd] cancelApply error', e);
    return fail('DB_ERROR', e.message || '取消失败');
  }
};

// ====== 6. 关闭招募（仅创建者） ======
const closePost = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 不能为空');

  try {
    await ensureCollection(COL);
    const postRes = await db.collection(COL).doc(id).get();
    if (!postRes.data) return fail('NOT_FOUND', '帖子不存在');
    if (postRes.data._openid !== openid) return fail('FORBIDDEN', '只有发起人可以关闭');

    await db.collection(COL).doc(id).update({
      data: { status: 'closed', updatedAt: Date.now() }
    });
    // 关帖：同时取消该 post 下所有 pending 提醒
    await cancelRemindersByPost(id);
    return ok({ id });
  } catch (e) {
    console.error('[ballAdd] closePost error', e);
    return fail('DB_ERROR', e.message || '关闭失败');
  }
};

// ====== 6.5 确认完成（满员后创建者主动确认；状态 → 'completed'，广场不再展示） ======
// 注意：提醒**不**取消 —— 活动仍然要进行；用户依然需要 2 小时前提醒
const confirmComplete = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 不能为空');

  try {
    await ensureCollection(COL);
    const postRes = await db.collection(COL).doc(id).get();
    if (!postRes.data) return fail('NOT_FOUND', '帖子不存在');
    if (postRes.data._openid !== openid) return fail('FORBIDDEN', '只有发起人可以确认');
    // 已关闭 / 已完成 / 已过期 → 不允许重复操作
    if (postRes.data.status === 'completed') return fail('ALREADY_COMPLETED', '该帖已是已完成状态');
    if (postRes.data.status === 'closed') return fail('CLOSED', '该帖已关闭，无法确认');
    // 关键：必须满员才能确认
    if ((postRes.data.currentCount || 0) < (postRes.data.needCount || 0)) {
      return fail('NOT_FULL', '人员未凑齐，无法确认');
    }

    await db.collection(COL).doc(id).update({
      data: {
        status: 'completed',
        completedAt: Date.now(),
        updatedAt: Date.now()
      }
    });
    return ok({ id });
  } catch (e) {
    console.error('[ballAdd] confirmComplete error', e);
    return fail('DB_ERROR', e.message || '确认失败');
  }
};

// ====== 7. 删除帖子（仅创建者） ======
const deletePost = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 不能为空');

  try {
    await ensureCollection(COL);
    const postRes = await db.collection(COL).doc(id).get();
    if (!postRes.data) return fail('NOT_FOUND', '帖子不存在');
    if (postRes.data._openid !== openid) return fail('FORBIDDEN', '只有发起人可以删除');

    await db.collection(COL).doc(id).remove();
    // 删除帖子：兜底取消该 post 下所有 pending 提醒
    // （主要取消由关闭/删除流程负责，此处保险；若帖子已 remove 后集合中残留也不会发送）
    await cancelRemindersByPost(id);
    return ok({ id });
  } catch (e) {
    console.error('[ballAdd] deletePost error', e);
    return fail('DB_ERROR', e.message || '删除失败');
  }
};

// ====== 8. 我发起的约球 ======
// 关键：先试 orderBy 排序（依赖 createdAt 索引）；失败则降级为无序，
//       避免因索引缺失直接报 DB_ERROR 导致"看不到我的发布"
const myPosts = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  try {
    await ensureCollection(COL);
    let data = [];
    try {
      // 优先走排序查询
      const res = await db.collection(COL)
        .where({ _openid: openid })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      data = res.data || [];
    } catch (e1) {
      // 关键：orderBy 失败（通常因为没建 createdAt 索引）→ 降级为无序
      console.warn('[ballAdd] myPosts orderBy 失败，降级为无序:', e1.message);
      const res2 = await db.collection(COL)
        .where({ _openid: openid })
        .limit(50)
        .get();
      data = res2.data || [];
      // 内存里手动按 createdAt 降序
      data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    const now = Date.now();
    return ok({
      list: data.map((p) => withEffectiveStatus(p, now)),
      // 关键：返回 openid 给前端 console 校验，避免 openid 不一致造成"看不到"
      _debug: { openid: openid.slice(0, 6) + '***', count: data.length }
    });
  } catch (e) {
    console.error('[ballAdd] myPosts error', e);
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ====== 9. 我加入的约球（已申请入队） ======
const myJoined = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  try {
    // 云数据库支持点查询：joinedUsers.openid == openid
    await ensureCollection(COL);
    let data = [];
    try {
      const res = await db.collection(COL)
        .where({ 'joinedUsers.openid': openid })
        .orderBy('createdAt', 'desc')
        .limit(50)
        .get();
      data = res.data || [];
    } catch (e1) {
      // 索引缺失降级
      console.warn('[ballAdd] myJoined orderBy 失败，降级为无序:', e1.message);
      const res2 = await db.collection(COL)
        .where({ 'joinedUsers.openid': openid })
        .limit(50)
        .get();
      data = res2.data || [];
      data.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    }
    const now = Date.now();
    return ok({
      list: data.map((p) => withEffectiveStatus(p, now)),
      _debug: { openid: openid.slice(0, 6) + '***', count: data.length }
    });
  } catch (e) {
    console.error('[ballAdd] myJoined error', e);
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ====== 10. 我需要赴约的约球（首页提示用） ======
// 规则：用户作为创建者 或 入队者；post 未关闭；post.time 在未来
// 按 post.time 升序，最多返回 5 条
// 同时返回 total 总数，方便前端判断是否展示「查看全部」
const myUpcoming = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  try {
    await ensureCollection(COL);
    // 拉上限 200 条：单个小程序量级足够
    const res = await db.collection(COL)
      .orderBy('createdAt', 'desc')
      .limit(200)
      .get();
    const now = Date.now();
    // 解析 post.time 为时间戳
    const parseTs = (s) => {
      if (!s) return NaN;
      return new Date(String(s).replace(' ', 'T')).getTime();
    };
    const visible = (res.data || []).filter((p) => {
      // 必须是我参与
      const isCreator = p._openid === openid;
      const isJoined = (p.joinedUsers || []).some((u) => u.openid === openid);
      if (!isCreator && !isJoined) return false;
      // 已关闭 → 不展示
      if (p.status === 'closed') return false;
      // 时间在未来
      const ts = parseTs(p.time);
      if (!Number.isFinite(ts) || ts <= now) return false;
      return true;
    });
    // 按时间升序（最近的要去的在前）
    visible.sort((a, b) => parseTs(a.time) - parseTs(b.time));
    // 计算每条距离现在还有多少 ms（前端可算倒计时）
    const enriched = visible.slice(0, 5).map((p) => {
      const ts = parseTs(p.time);
      const msUntil = ts - now;
      return Object.assign({}, p, {
        effectiveStatus: 'open',
        msUntil,
        role: p._openid === openid ? 'creator' : 'joiner'
      });
    });
    return ok({ list: enriched, total: visible.length });
  } catch (e) {
    console.error('[ballAdd] myUpcoming error', e);
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ====== 入口分发 ======
exports.main = async (event) => {
  const { type } = event;
  switch (type) {
    case 'add':         return await addPost(event);
    case 'list':        return await listPosts(event);
    case 'detail':      return await detailPost(event);
    case 'apply':       return await applyPost(event);
    case 'cancelApply': return await cancelApply(event);
    case 'close':          return await closePost(event);
    case 'confirmComplete':return await confirmComplete(event);
    case 'delete':         return await deletePost(event);
    case 'myPosts':     return await myPosts();
    case 'myJoined':    return await myJoined();
    case 'myUpcoming':  return await myUpcoming();
    default:
      return fail('INVALID_TYPE', `未知操作类型：${type}`);
  }
};
