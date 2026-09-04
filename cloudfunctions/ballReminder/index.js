// 云函数 ballReminder
// 职责：约球「提前 2 小时提醒」—— 应用内消息中心方案
//  type 取值：
//    'addReminder'     创建 / 复用一条提醒（pending）
//    'cancelReminder'  取消自己对该 post 的一条 pending 提醒
//    'cancelByPost'    取消某 post 的所有 pending 提醒（创建者关帖 / 删帖 用）
//    'myReminders'     拉取我作为 recipient 的所有 pending + ready 提醒（卡片 🔔 角标用）
//    'pendingReads'    拉取我所有未读（status='ready'）的提醒（App.onShow 弹窗用）
//    'markRead'        把指定一条提醒标为 read
//    'markAllRead'     一键全部已读
//    'notificationList'拉取我的所有 ready + read 提醒（提醒中心页面用）
//    'runTimer'        定时器入口（每分钟），把到期的 pending → ready
//
// 状态机：
//   pending  → 已开启提醒，定时器还没到时间
//   ready    → 定时器到时间，已写入消息中心，等待用户查看（前端弹窗 / 提醒中心）
//   read     → 用户已查看
//   cancelled→ 被取消（关帖 / 取消入队 / 用户主动关闭）
//   failed   → 保留字段（本方案未使用，保留以便未来切换回订阅消息时复用）
//
// 权限：
//   - addReminder / cancelReminder / myReminders / pendingReads / markRead / markAllRead / notificationList：取当前 OPENID
//   - cancelByPost：必须验证请求者 openid == 该 post._openid
//   - runTimer：仅云端定时器可调用

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const REM_COL = 'ball_reminders';
const POST_COL = 'ball_posts';

// 提前 2 小时
const REMIND_OFFSET_MS = 2 * 60 * 60 * 1000;

const getOpenId = () => {
  const wxContext = cloud.getWXContext();
  return wxContext.OPENID || '';
};

const ok = (data = null) => ({ success: true, data });
const fail = (code, msg) => ({ success: false, errCode: code, errMsg: msg });

// 兜底：任何错误都吞掉 + 打日志，不让 ensureCollection 把云函数打死
const ensureCollection = async (name) => {
  try {
    await db.createCollection(name);
    console.log(`[ballReminder] 已自动创建集合 ${name}`);
  } catch (e) {
    const m = (e && (e.errMsg || e.message)) || '';
    if (e && (e.errCode === -501001 || /already exist/i.test(m))) return;
    console.error(`[ballReminder] ensureCollection(${name}) 失败（忽略，继续）:`, m);
  }
};

// 运动项目 → 中文名（runTimer 写消息中心时用）
const SPORT_MAP = {
  tennis: '网球',
  basketball: '篮球',
  badminton: '羽毛球',
  football: '足球',
  pingpong: '乒乓球',
  volleyball: '排球'
};

// ============ 工具：把 "2026-09-04 14:00" 解析为毫秒时间戳 ============
const parsePostTime = (s) => {
  if (!s) return NaN;
  return new Date(String(s).replace(' ', 'T')).getTime();
};

// ============ 工具：算出 remindAt ============
//   1) post.time 解析失败   → { err: 'INVALID' }
//   2) post.time 已在过去   → { err: 'PAST' }
//   3) post.time - 2h 仍未来 → { remindAt: postTime - 2h }
//   4) 不足 2h（target<=now）→ { remindAt: now }（立即提醒）
const computeRemindAt = (post, now = Date.now()) => {
  const postTs = parsePostTime(post.time);
  if (!Number.isFinite(postTs)) return { err: 'INVALID' };
  if (postTs <= now) return { err: 'PAST' };
  const target = postTs - REMIND_OFFSET_MS;
  if (target <= now) return { remindAt: now };
  return { remindAt: target };
};

// ============ 1. addReminder ============
const addReminder = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  const { postId, recipientKind } = event;
  if (!postId) return fail('INVALID_PARAM', 'postId 不能为空');
  if (recipientKind !== 'creator' && recipientKind !== 'joiner') {
    return fail('INVALID_PARAM', 'recipientKind 必须为 creator 或 joiner');
  }

  try {
    await ensureCollection(REM_COL);
    const postRes = await db.collection(POST_COL).doc(postId).get();
    const post = postRes.data;
    if (!post) return fail('NOT_FOUND', '帖子不存在');

    // 权限：recipient 必须是当前用户本人
    if (recipientKind === 'creator' && post._openid !== openid) {
      return fail('FORBIDDEN', '只有发起人可为自己设置提醒');
    }
    if (recipientKind === 'joiner') {
      const joined = post.joinedUsers || [];
      const isJoined = joined.some((u) => u.openid === openid);
      if (!isJoined) return fail('FORBIDDEN', '只有已加入者可为自己设置提醒');
    }

    // 帖子已关闭 / 已过期
    if (post.status === 'closed') return fail('CLOSED', '该帖已关闭，无法开启提醒');
    if (post.recruitDeadline && Date.now() > post.recruitDeadline) {
      return fail('EXPIRED', '该帖已过期，无法开启提醒');
    }

    // 算 remindAt
    const r = computeRemindAt(post);
    if (r.err === 'INVALID') return fail('INVALID_PARAM', '帖子时间格式错误');
    if (r.err === 'PAST') return fail('PAST_TIME', '帖子时间已过，无法设置提醒');

    // 幂等：同一 (postId, recipient) 已有 pending → 复用并刷新 remindAt
    const existRes = await db.collection(REM_COL)
      .where({ postId, recipientOpenid: openid, status: 'pending' })
      .limit(1)
      .get();
    const now = Date.now();
    if (existRes.data && existRes.data.length > 0) {
      const old = existRes.data[0];
      await db.collection(REM_COL).doc(old._id).update({
        data: { remindAt: r.remindAt, updatedAt: now }
      });
      return ok({ _id: old._id, remindAt: r.remindAt, reused: true });
    }

    const addRes = await db.collection(REM_COL).add({
      data: {
        postId,
        recipientOpenid: openid,
        recipientKind,
        postTime: post.time,
        remindAt: r.remindAt,
        status: 'pending',
        createdAt: now,
        updatedAt: now
      }
    });
    return ok({ _id: addRes._id, remindAt: r.remindAt, reused: false });
  } catch (e) {
    console.error('[ballReminder] addReminder error', e);
    return fail('DB_ERROR', e.message || '创建失败');
  }
};

// ============ 2. cancelReminder ============
const cancelReminder = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  const { postId } = event;
  if (!postId) return fail('INVALID_PARAM', 'postId 不能为空');

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
        data: { status: 'cancelled', updatedAt: now, failReason: 'USER_OPT_OUT' }
      });
    }
    return ok({ cancelledCount: list.length });
  } catch (e) {
    console.error('[ballReminder] cancelReminder error', e);
    return fail('DB_ERROR', e.message || '取消失败');
  }
};

// ============ 3. cancelByPost ============
const cancelByPost = async (event) => {
  const { postId, openid } = event;
  if (!postId) return fail('INVALID_PARAM', 'postId 不能为空');
  if (!openid) return fail('INVALID_PARAM', 'openid 不能为空');

  try {
    await ensureCollection(REM_COL);
    const postRes = await db.collection(POST_COL).doc(postId).get();
    if (!postRes.data) return fail('NOT_FOUND', '帖子不存在');
    if (postRes.data._openid !== openid) return fail('FORBIDDEN', '只有创建者可以批量取消');

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
    return ok({ cancelledCount: list.length });
  } catch (e) {
    console.error('[ballReminder] cancelByPost error', e);
    return fail('DB_ERROR', e.message || '批量取消失败');
  }
};

// ============ 4. myReminders ============
// 拉取我所有 pending + ready 状态（用于我的页面 🔔 角标 + 提醒中心）
const myReminders = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  try {
    await ensureCollection(REM_COL);
    // 用 status in ['pending', 'ready'] 过滤（用 _.in 替代多个 or 条件）
    const res = await db.collection(REM_COL)
      .where({
        recipientOpenid: openid,
        status: _.in(['pending', 'ready'])
      })
      .orderBy('remindAt', 'asc')
      .limit(100)
      .get();
    return ok({ list: res.data || [] });
  } catch (e) {
    console.error('[ballReminder] myReminders error', e);
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ============ 5. pendingReads ============
// 拉取我所有未读（status='ready'）的提醒，用于 App.onShow 弹窗
const pendingReads = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  try {
    await ensureCollection(REM_COL);
    const res = await db.collection(REM_COL)
      .where({ recipientOpenid: openid, status: 'ready' })
      .orderBy('notifiedAt', 'asc')
      .limit(20)
      .get();
    // 顺手把每条都补上中文 sportLabel，方便前端弹窗
    const list = (res.data || []).map((x) => Object.assign({}, x, {
      sportLabel: SPORT_MAP[x.sport] || x.sport || '约球'
    }));
    return ok({ list });
  } catch (e) {
    console.error('[ballReminder] pendingReads error', e);
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ============ 6. markRead ============
// 把指定一条 ready 提醒标为 read
const markRead = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 不能为空');

  try {
    await ensureCollection(REM_COL);
    // 先校验归属
    const docRes = await db.collection(REM_COL).doc(id).get();
    if (!docRes.data) return fail('NOT_FOUND', '提醒不存在');
    if (docRes.data.recipientOpenid !== openid) return fail('FORBIDDEN', '只能标记自己的提醒');
    if (docRes.data.status === 'read') return ok({ _id: id, already: true });
    await db.collection(REM_COL).doc(id).update({
      data: { status: 'read', readAt: Date.now(), updatedAt: Date.now() }
    });
    return ok({ _id: id });
  } catch (e) {
    console.error('[ballReminder] markRead error', e);
    return fail('DB_ERROR', e.message || '标记失败');
  }
};

// ============ 7. markAllRead ============
const markAllRead = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  try {
    await ensureCollection(REM_COL);
    const res = await db.collection(REM_COL)
      .where({ recipientOpenid: openid, status: 'ready' })
      .limit(100)
      .get();
    const list = res.data || [];
    const now = Date.now();
    for (const doc of list) {
      await db.collection(REM_COL).doc(doc._id).update({
        data: { status: 'read', readAt: now, updatedAt: now }
      });
    }
    return ok({ marked: list.length });
  } catch (e) {
    console.error('[ballReminder] markAllRead error', e);
    return fail('DB_ERROR', e.message || '标记失败');
  }
};

// ============ 8. notificationList ============
// 提醒中心页面用：拉取我所有 ready + read 状态的提醒，按 notifiedAt desc
const notificationList = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  try {
    await ensureCollection(REM_COL);
    const res = await db.collection(REM_COL)
      .where({
        recipientOpenid: openid,
        status: _.in(['ready', 'read'])
      })
      .orderBy('notifiedAt', 'desc')
      .limit(100)
      .get();
    const list = (res.data || []).map((x) => Object.assign({}, x, {
      sportLabel: SPORT_MAP[x.sport] || x.sport || '约球'
    }));
    // 顺便算下未读数，方便「全部已读」按钮
    const unreadCount = list.filter((x) => x.status === 'ready').length;
    return ok({ list, unreadCount });
  } catch (e) {
    console.error('[ballReminder] notificationList error', e);
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ============ 9. runTimer ============
// 定时器入口（每分钟）。
// 查 status='pending' AND remindAt ∈ (now-5min, now] 的所有记录
// 把每条改为 status='ready'，并写入 notifiedAt
const runTimer = async () => {
  try {
    await ensureCollection(REM_COL);
    const now = Date.now();
    // 5 分钟窗口：兜底上一分钟漏跑
    const winLow = now - 5 * 60 * 1000;
    const res = await db.collection(REM_COL)
      .where({
        status: 'pending',
        remindAt: _.lte(now).and(_.gt(winLow))
      })
      .limit(50)
      .get();
    const list = res.data || [];
    console.log(`[ballReminder] runTimer 命中 ${list.length} 条`);
    let ready = 0, cancelled = 0;
    for (const doc of list) {
      try {
        // 兜底：拉 post 看是否仍可发
        let post = null;
        try {
          const p = await db.collection(POST_COL).doc(doc.postId).get();
          post = p.data;
        } catch (_) { post = null; }

        if (!post) {
          await db.collection(REM_COL).doc(doc._id).update({
            data: { status: 'cancelled', updatedAt: now, failReason: 'POST_DELETED' }
          });
          cancelled++;
          continue;
        }
        if (post.status === 'closed') {
          await db.collection(REM_COL).doc(doc._id).update({
            data: { status: 'cancelled', updatedAt: now, failReason: 'POST_CLOSED' }
          });
          cancelled++;
          continue;
        }

        // 写入 ready（消息中心）
        await db.collection(REM_COL).doc(doc._id).update({
          data: {
            status: 'ready',
            notifiedAt: now,
            sport: post.sport,           // 顺手存 sport，弹窗时不用再 join
            location: post.location,
            time: post.time,
            updatedAt: now
          }
        });
        ready++;
      } catch (e) {
        console.error('[ballReminder] runTimer process failed', e);
      }
    }
    return ok({ scanned: list.length, ready, cancelled });
  } catch (e) {
    console.error('[ballReminder] runTimer error', e);
    return fail('TIMER_ERROR', e.message || '定时器异常');
  }
};

// ============ 入口分发 ============
exports.main = async (event) => {
  const { type } = event;
  switch (type) {
    case 'addReminder':     return await addReminder(event);
    case 'cancelReminder':  return await cancelReminder(event);
    case 'cancelByPost':    return await cancelByPost(event);
    case 'myReminders':     return await myReminders();
    case 'pendingReads':    return await pendingReads();
    case 'markRead':        return await markRead(event);
    case 'markAllRead':     return await markAllRead();
    case 'notificationList':return await notificationList();
    case 'runTimer':        return await runTimer();
    default:
      return fail('INVALID_TYPE', '未知操作类型：' + type);
  }
};
