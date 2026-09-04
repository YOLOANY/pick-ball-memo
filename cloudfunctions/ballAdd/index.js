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
//    'delete'      删除帖子（仅创建者）
//    'myPosts'     我发起的约球
//    'myJoined'    我加入的约球（joinedUsers.openid 查询）
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

// 工具：取当前用户 openid
const getOpenId = () => {
  const wxContext = cloud.getWXContext();
  return wxContext.OPENID || '';
};

// 工具：统一返回结构
const ok = (data = null) => ({ success: true, data });
const fail = (errCode, errMsg) => ({ success: false, errCode, errMsg });

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
    const now = Date.now();
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
        status: 'open',             // open / closed
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
const listPosts = async (event) => {
  const pageSize = Math.min(Number(event.pageSize) || 20, 50);
  const skip = Math.max(Number(event.skip) || 0, 0);
  try {
    const res = await db.collection(COL)
      .orderBy('createdAt', 'desc')
      .skip(skip)
      .limit(pageSize)
      .get();
    return ok({
      list: res.data,
      total: res.data.length,
      skip,
      pageSize
    });
  } catch (e) {
    console.error('[ballAdd] listPosts error', e);
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ====== 3. 详情 ======
const detailPost = async (event) => {
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 不能为空');
  try {
    const res = await db.collection(COL).doc(id).get();
    return ok(res.data);
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
    const postRes = await db.collection(COL).doc(id).get();
    const post = postRes.data;
    if (!post) return fail('NOT_FOUND', '帖子不存在');
    if (post._openid === openid) return fail('OWN_POST', '不能申请加入自己发起的约球');
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
    const postRes = await db.collection(COL).doc(id).get();
    if (!postRes.data) return fail('NOT_FOUND', '帖子不存在');
    if (postRes.data._openid !== openid) return fail('FORBIDDEN', '只有发起人可以关闭');

    await db.collection(COL).doc(id).update({
      data: { status: 'closed', updatedAt: Date.now() }
    });
    return ok({ id });
  } catch (e) {
    console.error('[ballAdd] closePost error', e);
    return fail('DB_ERROR', e.message || '关闭失败');
  }
};

// ====== 7. 删除帖子（仅创建者） ======
const deletePost = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '无法识别用户身份');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 不能为空');

  try {
    const postRes = await db.collection(COL).doc(id).get();
    if (!postRes.data) return fail('NOT_FOUND', '帖子不存在');
    if (postRes.data._openid !== openid) return fail('FORBIDDEN', '只有发起人可以删除');

    await db.collection(COL).doc(id).remove();
    return ok({ id });
  } catch (e) {
    console.error('[ballAdd] deletePost error', e);
    return fail('DB_ERROR', e.message || '删除失败');
  }
};

// ====== 8. 我发起的约球 ======
const myPosts = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  try {
    const res = await db.collection(COL)
      .where({ _openid: openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return ok({ list: res.data });
  } catch (e) {
    return fail('DB_ERROR', e.message || '查询失败');
  }
};

// ====== 9. 我加入的约球（已申请入队） ======
const myJoined = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  try {
    // 云数据库支持点查询：joinedUsers.openid == openid
    const res = await db.collection(COL)
      .where({ 'joinedUsers.openid': openid })
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get();
    return ok({ list: res.data });
  } catch (e) {
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
    case 'close':       return await closePost(event);
    case 'delete':      return await deletePost(event);
    case 'myPosts':     return await myPosts();
    case 'myJoined':    return await myJoined();
    default:
      return fail('INVALID_TYPE', `未知操作类型：${type}`);
  }
};
