// 云函数 equipment
// 器材共享：equipment（器材信息）、equipment_order（租借订单）
//  type:
//    'publish'      发布器材
//    'list'         列表浏览
//    'detail'       器材详情
//    'borrow'       发起租借
//    'cancel'       取消租借
//    'myBorrows'    我的租借（我借的）
//    'myPublished'  我发布的器材

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const EQUIP = 'equipment';
const ORDER = 'equipment_order';

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
    console.log(`[equipment] 已自动创建集合 ${name}`);
  } catch (e) {
    const msg = (e && (e.errMsg || e.message)) || '';
    if (e && (e.errCode === -501001 || /already exist/i.test(msg))) {
      return; // 集合已存在，正常
    }
    // 其他错误（权限、API 不可用等）只记日志，不抛
    // 后续 db.collection(name).get() 会以 -502005 暴露真正的问题
    console.error(`[equipment] ensureCollection(${name}) 失败（忽略，继续）:`, msg);
  }
};

// ============ 发布器材 ============
const publish = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.name) return fail('INVALID_PARAM', '器材名称必填');
  if (!p.category) return fail('INVALID_PARAM', '请选择分类');
  if (!p.deposit && p.deposit !== 0) return fail('INVALID_PARAM', '请填写押金');

  try {
    await ensureCollection(EQUIP);
    const now = Date.now();
    const res = await db.collection(EQUIP).add({
      data: {
        name: String(p.name).slice(0, 50),
        category: p.category,           // racket / ball / shoe / other
        pricePerDay: Number(p.pricePerDay) || 0,
        deposit: Number(p.deposit) || 0,
        condition: String(p.condition || '九成新').slice(0, 100),
        description: String(p.description || '').slice(0, 200),
        coverUrl: String(p.coverUrl || ''),
        contact: String(p.contact || '').slice(0, 50),
        status: 'available',            // available / rented / offline
        nickName: String(p.nickName || '拾球记用户').slice(0, 30),
        createdAt: now
      }
    });
    return ok({ _id: res._id });
  } catch (e) {
    console.error('[equipment] publish error', e);
    return fail('DB_ERROR', e.message || '发布失败');
  }
};

// ============ 列表 ============
const list = async () => {
  await ensureCollection(EQUIP);
  const res = await db.collection(EQUIP)
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

// ============ 详情 ============
const detail = async (event) => {
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  await ensureCollection(EQUIP);
  const res = await db.collection(EQUIP).doc(id).get();
  return ok(res.data);
};

// ============ 发起租借 ============
const borrow = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.equipId) return fail('INVALID_PARAM', 'equipId 必填');
  if (!p.days || p.days < 1) return fail('INVALID_PARAM', '租借天数至少 1');

  try {
    await ensureCollection(EQUIP);
    await ensureCollection(ORDER);
    const eq = await db.collection(EQUIP).doc(p.equipId).get();
    if (!eq.data) return fail('NOT_FOUND', '器材不存在');
    if (eq.data._openid === openid) return fail('OWN_ITEM', '不能租借自己发布的器材');
    if (eq.data.status !== 'available') return fail('UNAVAILABLE', '该器材当前不可租借');

    const now = Date.now();
    const res = await db.collection(ORDER).add({
      data: {
        equipId: p.equipId,
        equipName: eq.data.name,
        equipCover: eq.data.coverUrl,
        days: Number(p.days),
        rentFee: Number(p.days) * (eq.data.pricePerDay || 0),
        deposit: eq.data.deposit || 0,
        contact: String(p.contact || '').slice(0, 50),
        remark: String(p.remark || '').slice(0, 200),
        status: 'pending',         // pending / confirmed / returned / cancelled
        nickName: String(p.nickName || '拾球记用户').slice(0, 30),
        createdAt: now,
        updatedAt: now
      }
    });
    return ok({ _id: res._id });
  } catch (e) {
    console.error('[equipment] borrow error', e);
    return fail('DB_ERROR', e.message || '租借失败');
  }
};

// ============ 取消租借 ============
const cancel = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  try {
    await ensureCollection(ORDER);
    const cur = await db.collection(ORDER).doc(id).get();
    if (!cur.data) return fail('NOT_FOUND', '订单不存在');
    if (cur.data._openid !== openid) return fail('FORBIDDEN', '只能取消自己的订单');
    if (cur.data.status === 'cancelled') return fail('STATE', '订单已取消');
    await db.collection(ORDER).doc(id).update({
      data: { status: 'cancelled', updatedAt: Date.now() }
    });
    return ok({ id });
  } catch (e) {
    return fail('DB_ERROR', e.message || '取消失败');
  }
};

// ============ 我借的 ============
const myBorrows = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  await ensureCollection(ORDER);
  const res = await db.collection(ORDER)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

// ============ 我发布的器材 ============
const myPublished = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  await ensureCollection(EQUIP);
  const res = await db.collection(EQUIP)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

exports.main = async (event) => {
  switch (event.type) {
    case 'publish':     return await publish(event);
    case 'list':        return await list();
    case 'detail':      return await detail(event);
    case 'borrow':      return await borrow(event);
    case 'cancel':      return await cancel(event);
    case 'myBorrows':   return await myBorrows();
    case 'myPublished': return await myPublished();
    default: return fail('INVALID_TYPE', `未知 type：${event.type}`);
  }
};
