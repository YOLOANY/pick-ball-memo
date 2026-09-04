// pages/mine/index.js
// 个人中心
// 三个 tab：我的发布（球） / 我的约球（加入的） / 我的租借
const app = getApp();
const SPORT_EMOJI = {
  tennis: '🎾', basketball: '🏀', badminton: '🏸',
  football: '⚽', pingpong: '🏓', volleyball: '🏐', other: '🏃'
};
const SPORT_LABEL = {
  tennis: '网球', basketball: '篮球', badminton: '羽毛球',
  football: '足球', pingpong: '乒乓球', volleyball: '排球', other: '运动'
};
const BALL_STATUS = { open: '招募中', closed: '已截止' };
const BORROW_STATUS = { pending: '待确认', confirmed: '已确认', returned: '已归还', cancelled: '已取消' };

Page({
  data: {
    userInfo: {},
    shortId: '',
    stats: { posts: 0, joined: 0, borrows: 0 },
    tab: 'posts',
    list: [],
    emptyText: '你还没有发布过约球',
    defaultAvatar: '/images/icons/avatar.png'
  },

  onLoad() { this.refresh(); },
  onShow() { this.refresh(); },
  onPullDownRefresh() { this.refresh().then(() => wx.stopPullDownRefresh()); },

  async refresh() {
    const userInfo = app.globalData.userInfo || {};
    const shortId = userInfo._openid ? userInfo._openid.slice(-6) : '';
    this.setData({ userInfo, shortId });

    if (!userInfo._openid) {
      this.setData({ list: [], stats: { posts: 0, joined: 0, borrows: 0 } });
      return;
    }
    // 拉取三组数量 + 当前 tab 列表
    await Promise.all([this._countAll(), this._loadTab(this.data.tab, true)]);
  },

  async _countAll() {
    try {
      const [a, b, c] = await Promise.all([
        wx.cloud.callFunction({ name: 'ballAdd',   data: { type: 'myPosts' } }),
        wx.cloud.callFunction({ name: 'ballAdd',   data: { type: 'myJoined' } }),
        wx.cloud.callFunction({ name: 'equipment', data: { type: 'myBorrows' } })
      ]);
      this.setData({
        stats: {
          posts:   (a.result && a.result.success) ? (a.result.data.list || []).length : 0,
          joined:  (b.result && b.result.success) ? (b.result.data.list || []).length : 0,
          borrows: (c.result && c.result.success) ? (c.result.data.list || []).length : 0
        }
      });
    } catch (e) {
      console.error('[mine] count error', e);
    }
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ tab, list: [] });
    this._loadTab(tab);
  },

  async _loadTab(tab, silent) {
    if (tab === 'posts') {
      this.setData({ emptyText: '你还没有发布过约球' });
      await this._loadBallPosts();
    } else if (tab === 'joined') {
      this.setData({ emptyText: '你还没有加入过约球' });
      await this._loadBallJoined();
    } else if (tab === 'borrows') {
      this.setData({ emptyText: '你还没有租借过器材' });
      await this._loadBorrows();
    }
  },

  async _loadBallPosts() {
    try {
      const resp = await wx.cloud.callFunction({ name: 'ballAdd', data: { type: 'myPosts' } });
      if (resp.result && resp.result.success) {
        const list = (resp.result.data.list || []).map((p) => ({
          _id: p._id, emoji: SPORT_EMOJI[p.sport] || '🏅',
          title: `${SPORT_LABEL[p.sport] || '运动'} · ${p.time}`,
          meta: `📍 ${p.location} · 👥 ${p.currentCount}/${p.needCount}`,
          statusLabel: BALL_STATUS[p.status] || ''
        }));
        this.setData({ list });
      } else {
        this.setData({ list: [] });
      }
    } catch (e) { this.setData({ list: [] }); }
  },

  async _loadBallJoined() {
    try {
      const resp = await wx.cloud.callFunction({ name: 'ballAdd', data: { type: 'myJoined' } });
      if (resp.result && resp.result.success) {
        const list = (resp.result.data.list || []).map((p) => ({
          _id: p._id, emoji: SPORT_EMOJI[p.sport] || '🏅',
          title: `${SPORT_LABEL[p.sport] || '运动'} · ${p.time}`,
          meta: `📍 ${p.location} · 发起人 ${p.nickName}`,
          statusLabel: BALL_STATUS[p.status] || ''
        }));
        this.setData({ list });
      } else {
        this.setData({ list: [] });
      }
    } catch (e) { this.setData({ list: [] }); }
  },

  async _loadBorrows() {
    try {
      const resp = await wx.cloud.callFunction({ name: 'equipment', data: { type: 'myBorrows' } });
      if (resp.result && resp.result.success) {
        const list = (resp.result.data.list || []).map((o) => ({
          _id: o._id, emoji: '🎒',
          title: o.equipName,
          meta: `⏱ ${o.days} 天 · 💰 ¥${o.rentFee || 0}`,
          statusLabel: BORROW_STATUS[o.status] || ''
        }));
        this.setData({ list });
      } else {
        this.setData({ list: [] });
      }
    } catch (e) { this.setData({ list: [] }); }
  },

  onTapItem(e) {
    const { id, type } = e.currentTarget.dataset;
    if (type === 'borrows') {
      // 租借列表暂不跳详情（器材可能已下架）
      return;
    }
    wx.navigateTo({ url: `/pages/ball/detail?id=${id}` });
  },

  onNavVenueMy()   { wx.navigateTo({ url: '/pages/venue/my' }); },
  onNavEquipMy()   { wx.navigateTo({ url: '/pages/equipment/my' }); },
  onNavMomentList(){ wx.navigateTo({ url: '/pages/moment/list' }); },
  onNavBallList()  { wx.navigateTo({ url: '/pages/ball/list' }); },

  async onTapProfile() {
    // 已登录则更新资料；未登录则拉取昵称头像
    const cur = app.globalData.userInfo || {};
    if (cur._openid) {
      const profile = await app.ensureUserProfile();
      if (profile && profile.nickName) {
        app.globalData.userInfo = { ...cur, ...profile };
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
      app.globalData.userInfo = { ...userInfo, ...(profile || {}) };
      this.setData({ userInfo: app.globalData.userInfo, shortId: userInfo._openid.slice(-6) });
      this._countAll();
      this._loadTab(this.data.tab);
    }
  }
});
