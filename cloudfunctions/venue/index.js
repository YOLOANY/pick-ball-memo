// 云函数 venue
// 校园场地预约：venue（场地信息）、venue_order（预约订单）
// 调用：wx.cloud.callFunction({ name: 'venue', data: { type, payload } })
//  type:
//    'seed'         首次部署时初始化示例场地（幂等）
//    'list'         列出全部场地
//    'detail'       场地详情
//    'order'        提交预约订单
//    'myOrders'     我的预约记录
//    'cancelOrder'  取消预约
//
// 权限约定同 ballAdd：所有写操作取真实 OPENID，前端传入只做展示用

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const VENUE = 'venue';
const ORDER = 'venue_order';

const ok = (data = null) => ({ success: true, data });
const fail = (errCode, errMsg) => ({ success: false, errCode, errMsg });
const getOpenId = () => cloud.getWXContext().OPENID || '';

// ============ 初始化示例场地（幂等） ============
const seed = async () => {
  const sample = [
    { name: '北校区网球场 1 号场', sport: 'tennis',     price: 30, capacity: 4, location: '北校区体育中心', openTime: '08:00-22:00', desc: '硬地网球场，灯光完善，可打夜场' },
    { name: '北校区羽毛球场 A 区', sport: 'badminton',  price: 20, capacity: 2, location: '北校区体育馆 2F', openTime: '08:00-22:00', desc: '标准羽毛球场，配地胶' },
    { name: '南校区篮球场 室外',   sport: 'basketball', price: 0,  capacity: 10,location: '南校区运动场',   openTime: '06:00-22:00', desc: '免费室外篮球场，多片连用' },
    { name: '南校区乒乓球室',       sport: 'pingpong',   price: 15, capacity: 2, location: '南校区学生活动中心 3F', openTime: '09:00-21:00', desc: '室内乒乓球台，空调开放' },
    { name: '西校区足球场',         sport: 'football',   price: 50, capacity: 22,location: '西校区田径场',   openTime: '08:00-21:00', desc: '11 人制标准足球场，真草' }
  ];

  // 已存在数量
  const cnt = await db.collection(VENUE).count();
  if (cnt.total >= sample.length) {
    return ok({ inserted: 0, message: '已存在示例数据，跳过初始化' });
  }
  // 清空再插入，保证幂等
  await db.collection(VENUE).where({ _id: _.neq('__never__') }).remove().catch(() => {});
  const now = Date.now();
  for (const v of sample) {
    await db.collection(VENUE).add({
      data: { ...v, status: 'open', createdAt: now }
    });
  }
  return ok({ inserted: sample.length });
};

// ============ 场地列表 ============
const list = async () => {
  const res = await db.collection(VENUE).orderBy('createdAt', 'asc').limit(50).get();
  return ok({ list: res.data });
};

// ============ 场地详情 ============
const detail = async (event) => {
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  const res = await db.collection(VENUE).doc(id).get();
  return ok(res.data);
};

// ============ 提交预约 ============
const order = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const p = event.payload || {};
  if (!p.venueId) return fail('INVALID_PARAM', 'venueId 必填');
  if (!p.date) return fail('INVALID_PARAM', '请选择日期');
  if (!p.timeSlot) return fail('INVALID_PARAM', '请选择时段');
  if (!p.hours || p.hours < 1) return fail('INVALID_PARAM', 'hours 至少 1');

  try {
    // 校验场地存在
    const v = await db.collection(VENUE).doc(p.venueId).get();
    if (!v.data) return fail('NOT_FOUND', '场地不存在');
    if (v.data.status !== 'open') return fail('CLOSED', '该场地暂未开放');

    const now = Date.now();
    const res = await db.collection(ORDER).add({
      data: {
        venueId: p.venueId,
        venueName: v.data.name,
        venueSport: v.data.sport,
        date: p.date,
        timeSlot: p.timeSlot,
        hours: Number(p.hours),
        totalPrice: Number(p.hours) * (v.data.price || 0),
        contact: String(p.contact || '').slice(0, 50),
        remark: String(p.remark || '').slice(0, 200),
        status: 'pending',     // pending / confirmed / cancelled
        nickName: String(p.nickName || '拾球记用户').slice(0, 30),
        createdAt: now,
        updatedAt: now
      }
    });
    return ok({ _id: res._id });
  } catch (e) {
    console.error('[venue] order error', e);
    return fail('DB_ERROR', e.message || '下单失败');
  }
};

// ============ 我的预约 ============
const myOrders = async () => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const res = await db.collection(ORDER)
    .where({ _openid: openid })
    .orderBy('createdAt', 'desc')
    .limit(50)
    .get();
  return ok({ list: res.data });
};

// ============ 取消预约（仅创建者） ============
const cancelOrder = async (event) => {
  const openid = getOpenId();
  if (!openid) return fail('NO_AUTH', '请先登录');
  const { id } = event;
  if (!id) return fail('INVALID_PARAM', 'id 必填');
  try {
    const cur = await db.collection(ORDER).doc(id).get();
    if (!cur.data) return fail('NOT_FOUND', '订单不存在');
    if (cur.data._openid !== openid) return fail('FORBIDDEN', '只能取消自己的预约');
    if (cur.data.status === 'cancelled') return fail('STATE', '订单已取消');
    await db.collection(ORDER).doc(id).update({
      data: { status: 'cancelled', updatedAt: Date.now() }
    });
    return ok({ id });
  } catch (e) {
    console.error('[venue] cancel error', e);
    return fail('DB_ERROR', e.message || '取消失败');
  }
};

exports.main = async (event) => {
  switch (event.type) {
    case 'seed':         return await seed();
    case 'list':         return await list();
    case 'detail':       return await detail(event);
    case 'order':        return await order(event);
    case 'myOrders':     return await myOrders();
    case 'cancelOrder':  return await cancelOrder(event);
    default: return fail('INVALID_TYPE', `未知 type：${event.type}`);
  }
};
