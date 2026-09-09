// pages/mine/index.js
// 个人中心
// 结构：资料卡 → 数据统计（4 格）→ 快捷入口（3 个）→ 运动偏好 → 菜单列表
// 说明：页面内不再有「发布 / 参与 / 租借」tab 列表，
//       这三类数据在本页只以统计数字呈现，详情统一跳到各自的专页
//       （约球 → ball/my，租借 → equipment/my?tab=borrows）
const app = getApp();
const { SPORT_OPTIONS, get: getPrefs, set: setPrefs } = require('../../utils/prefs.js');

// 工具：根据偏好生成带 isPreferred 标记的 sportOptions
// 关键 1：避免在 WXML 里用 {{preferredSports.includes(item.key)}} 表达式
//         （部分基础库版本对 Array.prototype.includes 解析异常，会导致整页空白）
// 关键 2：不要用对象 spread {...o, x:1} —— 在 libVersion 2.20 + Babel 配置下
//         Babel 会插入 @babel/runtime 的 helper 调用，导致 require 失败
//         改用 Object.assign 达到同样效果
function buildSportOptions(prefs) {
  const set = new Set(prefs || []);
  return SPORT_OPTIONS.map((o) => Object.assign({}, o, { isPreferred: set.has(o.key) }));
}

// 工具：解析 post.time 为时间戳（与云函数 parseTs 保持一致）
// 关键：返回 0 表示"无效/过去"，>0 表示"未来"
// 关键：post.time 是北京时间（UTC+8）；ES 规范按 UTC 解析无时区字符串，必须手动追加 +08:00
const parseTs = (s) => {
  if (!s) return 0;
  if (typeof s === 'number') return s;
  const norm = String(s).trim().replace(' ', 'T').replace(/\//g, '-');
  const t = new Date(norm + '+08:00').getTime();
  return Number.isFinite(t) ? t : 0;
};

// 关键：根据 post.time 拆成"未来要去的" + "已经过去的"
// 业务规则：统计里的"我的发布/我的约球"只算未来；"约球历史"只算过去
function splitByTime(list) {
  const now = Date.now();
  const future = [];
  const past = [];
  (list || []).forEach((p) => {
    const ts = parseTs(p.time);
    // 关键：ts > now 才算未来；ts <= now（包括无效时间）都算过去
    if (ts > now) future.push(p);
    else past.push(p);
  });
  return { future, past };
}

const EMPTY_STATS = { posts: 0, joined: 0, history: 0, borrows: 0 };

Page({
  data: {
    userInfo: {},
    shortId: '',
    stats: { posts: 0, joined: 0, history: 0, borrows: 0 },
    defaultAvatar: '/images/icons/avatar.png',
    // 运动偏好
    sportOptions: buildSportOptions([]),
    preferredSports: [],            // 当前已选（保存原始顺序，供其他地方用）
    // 菜单里"绑定手机号"那一行的右侧状态
    phoneText: '未绑定',
    phoneBound: false,
    // 议价未读总数：挂在"我的出物"快捷入口上做红点
    chatUnread: 0
  },

  onLoad() { this.refresh(); },
  onShow() { this.refresh(); },
  onPullDownRefresh() { this.refresh().then(() => wx.stopPullDownRefresh()); },

  async refresh() {
    const userInfo = app.globalData.userInfo || {};
    const shortId = userInfo._openid ? userInfo._openid.slice(-6) : '';
    // 关键：每次进入"我的"都重新读一遍本地偏好（可能在其他页面改过）
    const preferredSports = getPrefs();
    // 菜单"绑定手机号"那一行：根据本地是否存了 boundPhone 动态显示
    const boundPhone = wx.getStorageSync('boundPhone') || '';
    this.setData({
      userInfo,
      shortId,
      preferredSports,
      sportOptions: buildSportOptions(preferredSports),
      phoneText: boundPhone || '未绑定',
      phoneBound: !!boundPhone
    });

    if (!userInfo._openid) {
      // 关键：未登录时四项统计全部归零（含 history，漏掉会残留上一个账号的数字）
      // 议价红点同理，不然会残留上一个账号的未读数
      this.setData({ stats: Object.assign({}, EMPTY_STATS), chatUnread: 0 });
      return;
    }
    await this._countAll();
    this._countChatUnread();
  },

  // 议价未读总数：拉失败就当 0，红点不能影响页面主流程
  async _countChatUnread() {
    try {
      const r = await wx.cloud.callFunction({ name: 'equipment', data: { type: 'chatUnread' } });
      const count = (r.result && r.result.success) ? (r.result.data.count || 0) : 0;
      this.setData({ chatUnread: count });
    } catch (e) {
      console.warn('[mine] chatUnread 读取失败，红点按 0 处理', e);
    }
  },

  // 切换某个运动的偏好（多选）
  // 关键：不要用 [...cur, key] 数组 spread → Babel helper 问题
  //        改用 cur.concat([key]) 等价
  onTogglePref(e) {
    const { key } = e.currentTarget.dataset;
    if (!key) return;
    const cur = this.data.preferredSports || [];
    const next = cur.includes(key) ? cur.filter((k) => k !== key) : cur.concat([key]);
    setPrefs(next);
    this.setData({
      preferredSports: next,
      sportOptions: buildSportOptions(next)   // 同步刷新偏好样式
    });
    // 给一个轻量反馈
    wx.showToast({
      title: next.includes(key) ? '已加入偏好' : '已移出偏好',
      icon: 'none',
      duration: 800
    });
  },

  // 四格统计：我的发布 / 我的约球 / 约球历史 / 我的租借
  async _countAll() {
    try {
      const [a, b, c, d] = await Promise.all([
        wx.cloud.callFunction({ name: 'ballAdd',   data: { type: 'myPosts' } }),
        wx.cloud.callFunction({ name: 'ballAdd',   data: { type: 'myJoined' } }),
        wx.cloud.callFunction({ name: 'ballAdd',   data: { type: 'myHistory' } }),
        wx.cloud.callFunction({ name: 'equipment', data: { type: 'myBorrows' } })
      ]);
      // 关键：posts/joined 只统计"未来"的；历史单独统计
      const futurePosts = (a.result && a.result.success) ? splitByTime(a.result.data.list || []).future : [];
      const futureJoined = (b.result && b.result.success) ? splitByTime(b.result.data.list || []).future : [];
      const historyCount = (c.result && c.result.success) ? (c.result.data.list || []).length : 0;
      const borrowsCount = (d.result && d.result.success) ? (d.result.data.list || []).length : 0;
      this.setData({
        stats: {
          posts:   futurePosts.length,
          joined:  futureJoined.length,
          history: historyCount,
          borrows: borrowsCount
        }
      });
    } catch (e) {
      console.error('[mine] count error', e);
    }
  },

  // ============ 跳转 ============
  // 快捷入口：我的出物 → 落到「我发布的」tab，与菜单里的「我的租借记录」区分开，避免两个入口打开同一个视图
  // 例外：有议价未读时直接落到「议价」tab，否则用户点了红点却找不到消息在哪
  onNavVenueMy()      { wx.navigateTo({ url: '/pages/venue/my' }); },
  onNavEquipMy()      {
    const tab = this.data.chatUnread > 0 ? 'chats' : 'published';
    wx.navigateTo({ url: `/pages/equipment/my?tab=${tab}` });
  },
  onNavMomentList()   { wx.navigateTo({ url: '/pages/moment/list' }); },
  // 关键：约球历史入口。带 ?tab=history 让 ball/my 默认显示「历史」tab
  onNavBallHistory()  { wx.navigateTo({ url: '/pages/ball/my?tab=history' }); },
  onNavEquipBorrows() { wx.navigateTo({ url: '/pages/equipment/my?tab=borrows' }); },
  onNavHelp()         { wx.navigateTo({ url: '/pages/settings/help' }); },
  onNavBindPhone()    { wx.navigateTo({ url: '/pages/settings/bindPhone' }); },
  onNavSettings()     { wx.navigateTo({ url: '/pages/settings/index' }); },

  async onTapProfile() {
    // 已登录则更新资料；未登录则拉取昵称头像
    const cur = app.globalData.userInfo || {};
    if (cur._openid) {
      const profile = await app.ensureUserProfile();
      if (profile && profile.nickName) {
        // 关键：不用 { ...cur, ...profile } 对象 spread → 在该 Babel 配置下会触发
        //        @babel/runtime/helpers/arrayWithHoles 的 require 调用,
        //        改用 Object.assign 达到同样效果
        app.globalData.userInfo = Object.assign({}, cur, profile);
        this.setData({ userInfo: app.globalData.userInfo });
        wx.showToast({ title: '已更新', icon: 'success' });
      }
    } else {
      wx.showLoading({ title: '登录中…', mask: true });
      const userInfo = await app.loginSilently();
      wx.hideLoading();
      if (!userInfo) return wx.showToast({ title: '登录失败', icon: 'none' });
      // 主动拉一次昵称头像
      const profile = await app.ensureUserProfile();
      app.globalData.userInfo = Object.assign({}, userInfo, profile || {});
      this.setData({ userInfo: app.globalData.userInfo, shortId: userInfo._openid.slice(-6) });
      this._countAll();
    }
  }
});
