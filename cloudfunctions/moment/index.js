// 云函数 moment
// 运动打卡：moments 集合
//  type:
//    'publish'  发布动态（支持本地图片 fileID 列表）
//    'list'     动态广场（按 createdAt 倒序）
//    'detail'   动态详情
//    'delete'   删除（仅创建者）
//    'my'       我发布的动态

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COL = 'moments';

const ok = (data = null) => ({ success: true, data });
const fail = (errCode, errMsg) => ({ success: false, errCode, errMsg });
const getOpenId = () => cloud.getWXContext().OPENID || '';

// ============ 工具：确保集合存在 ============
// 微信云开发不会自动建集合，第一次操作前要显式 createCollection
// 否则会抛 -502005 "Db or Table not exist"；已存在会被忽略
// 兜底：任何其他错误都吞掉 + 打日志，不让 ensureCollection 自身把云函数打死
const ensureCollection = async (name) => {
  try {
    await db.createCollection(name);
    console.log(`[moment] 已自动创建集合 ${name}`);
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || '';
    if (e && (e.errCode === -501001 || /already exist/i.test(msg))) {
      return;
    }
    console.error(`[moment] ensureCollection(${name}) 失败（忽略，继续）:`, msg);
  }
};

// ============ 发布 ============
const publish = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.content) return fail('INVALID_PARAM', '动态内容不能为空');
  if (p.content.length > 500) return fail('INVALID_PARAM', '内容不能超过 500 字');

  // 可选：从前端接收已经上传到云存储的 fileID 列表
  const images = Array.isArray(p.images) ? p.images.slice(0, 9) : [];

  try {
    await ensureCollection(COL);
    const now = Date.now();
    const res = await db.collection(COL).add({
      data: {
        content: p.content,
        images,
        sport: p.sport || 'other',        // 运动项目
        mood: p.mood || '',                // 心情 emoji
        location: String(p.location || '').slice(0, 50),
        likeCount: 0,
        likedBy: [],
        nickName: String(p.nickName || '拾球记用户').slice(0, 30),
        avatarUrl: String(p.avatarUrl || ''),
        createdAt: now
      }
    });
    return ok({ _id: res._id });
  } catch (e) {
    console.error('[moment] publish error', e);
    return fail('DB_ERROR', e.message || '发布失败');
  }
};

// ============ 列表 ============
const list = async (event) => {
  const pageSize = Math.min(Number(event.pageSize) || 20, 50);
  const skip = Math.max(Number(event.skip) || 0, 0);
  await ensureCollection(COL);
  const res = await db.collection(COL)
    .orderBy('createdAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();
  return ok({ list: res.data, skip, pageSize });
};

// ============ 详情 ============
const detail = async (event) => {
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  await ensureCollection(COL);
  const res = await db.collection(COL).doc(id).get();
  return ok(res.data);
};

// ============ 删除 ============
const remove = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  try {
    await ensureCollection(COL);
    const cur = await db.collection(COL).doc(id).get();
    if (!cur.data) return fail('NOT_FOUND', '动态不存在');
    if (cur.data._openid !== openid) return fail('FORBIDDEN', '只能删除自己的动态');
    await db.collection(COL).doc(id).remove();
    return ok({ id });
  } catch (e) {
    return fail('DB_ERROR', e.message || '删除失败');
  }
};

// ============ 我的动态 ============
const my = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  await ensureCollection(COL);
  const res = await db.collection(COL)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

exports.main = async (event) => {
  switch (event.type) {
    case 'publish': return await publish(event);
    case 'list':    return await list(event);
    case 'detail':  return await detail(event);
    case 'delete':  return await remove(event);
    case 'my':      return await my();
    default: return fail('INVALID_TYPE', `未知 type：${event.type}`);
  }
};
