// pages/ball/detail.js
// 约球帖子详情页
// 职责：
//   1. 根据 id 拉取帖子详情
//   2. 判断当前用户身份（创建者 / 已加入 / 未加入 / 关闭）
//   3. 提供申请入队 / 取消入队 / 关闭招募 / 删除帖子 4 个动作

const app = getApp();

const SPORT_MAP = {
  tennis:     { label: '网球',   emoji: '🎾' },
  basketball: { label: '篮球',   emoji: '🏀' },
  badminton:  { label: '羽毛球', emoji: '🏸' },
  football:   { label: '足球',   emoji: '⚽' },
  pingpong:   { label: '乒乓球', emoji: '🏓' },
  volleyball: { label: '排球',   emoji: '🏐' }
};

const SCOPE_MAP = {
  all:     '全校同学',
  college: '本院同学',
  grade:   '同年级'
};

Page({
  data: {
    id: '',
    post: null,
    isCreator: false,    // 当前用户是否是创建者
    isJoined: false,     // 当前用户是否已加入
    applying: false,     // 申请按钮 loading
    defaultAvatar: '/images/icons/avatar.png'
  },

  onLoad(query) {
    const id = (query && query.id) || '';
    if (!id) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ id });
    this.fetchDetail();
  },

  // 拉取详情 + 判断身份
  async fetchDetail() {
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type: 'detail', id: this.data.id }
      });
      wx.hideLoading();
      if (resp.result && resp.result.success) {
        const post = this._mapPost(resp.result.data);
        // 判断身份
        const myOpenid = (app.globalData.userInfo && app.globalData.userInfo._openid) || '';
        const isCreator = myOpenid && post._openid === myOpenid;
        const isJoined = myOpenid && (post.joinedUsers || []).some((u) => u.openid === myOpenid);
        this.setData({ post, isCreator, isJoined });
      } else {
        wx.showToast({
          title: (resp.result && resp.result.errMsg) || '加载失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.hideLoading();
      console.error('[ball detail] fetch failed 真实错误:', e);
      const realErr = (e && (e.errMsg || e.message)) || JSON.stringify(e);
      wx.showModal({
        title: '加载失败',
        content: '真实错误：' + realErr,
        showCancel: false
      });
    }
  },

  // 字段映射
  _mapPost(post) {
    const sport = SPORT_MAP[post.sport] || { label: post.sport, emoji: '🏅' };
    const progress = Math.min(
      Math.round(((post.currentCount || 1) / (post.needCount || 1)) * 100),
      100
    );
    return {
      ...post,
      sportLabel: sport.label,
      sportEmoji: sport.emoji,
      scopeLabel: SCOPE_MAP[post.scope] || '全校同学',
      progress,
      createdAtText: this._formatDateTime(post.createdAt)
    };
  },

  _formatDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // ============ 动作：申请入队 ============
  async onApply() {
    if (this.data.applying) return;

    // 1) 登录态校验：未拿到 openid 则先静默登录一次
    const app2 = getApp();
    if (!app2.globalData.userInfo || !app2.globalData.userInfo._openid) {
      try {
        const userInfo = await app2.loginSilently();
        if (!userInfo || !userInfo._openid) {
          return wx.showToast({ title: '请先登录', icon: 'none' });
        }
      } catch (e) {
        return wx.showToast({ title: '登录失败', icon: 'none' });
      }
    }

    this.setData({ applying: true });
    try {
      const userInfo = getApp().globalData.userInfo || {};
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: {
          type: 'apply',
          id: this.data.id,
          nickName: userInfo.nickName,
          avatarUrl: userInfo.avatarUrl
        }
      });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '申请成功', icon: 'success' });
        // 重新拉取详情，刷新当前状态
        this.fetchDetail();
      } else {
        const errMap = {
          OWN_POST: '不能加入自己发起的约球',
          CLOSED: '该帖已关闭招募',
          FULL: '人数已满',
          DUPLICATE: '你已申请过该帖',
          NOT_FOUND: '帖子不存在',
          NO_AUTH: '请先登录'
        };
        const code = (resp.result && resp.result.errCode) || '';
        wx.showToast({
          title: errMap[code] || (resp.result && resp.result.errMsg) || '申请失败',
          icon: 'none'
        });
      }
    } catch (e) {
      console.error('[ball detail] apply failed', e);
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      this.setData({ applying: false });
    }
  },

  // ============ 动作：取消入队 ============
  async onCancelApply() {
    const confirmed = await this._confirm('确认取消入队？');
    if (!confirmed) return;
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type: 'cancelApply', id: this.data.id }
      });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '已取消', icon: 'success' });
        this.fetchDetail();
      } else {
        wx.showToast({
          title: (resp.result && resp.result.errMsg) || '操作失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // ============ 动作：关闭招募 ============
  async onClose() {
    const confirmed = await this._confirm('关闭后无法再申请入队，确定吗？');
    if (!confirmed) return;
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type: 'close', id: this.data.id }
      });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '已关闭', icon: 'success' });
        this.fetchDetail();
      } else {
        wx.showToast({
          title: (resp.result && resp.result.errMsg) || '操作失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // ============ 动作：删除帖子 ============
  async onDelete() {
    const confirmed = await this._confirm('删除后不可恢复，确定吗？');
    if (!confirmed) return;
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type: 'delete', id: this.data.id }
      });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '已删除', icon: 'success' });
        setTimeout(() => wx.navigateBack(), 800);
      } else {
        wx.showToast({
          title: (resp.result && resp.result.errMsg) || '操作失败',
          icon: 'none'
        });
      }
    } catch (e) {
      wx.showToast({ title: '网络异常', icon: 'none' });
    }
  },

  // 工具：统一确认弹窗
  _confirm(content) {
    return new Promise((resolve) => {
      wx.showModal({
        title: '提示',
        content,
        success: (res) => resolve(res.confirm)
      });
    });
  }
});
