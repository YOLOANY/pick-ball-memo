// pages/equipment/detail.js
const app = getApp();
const { callCloud } = require('../../utils/cloud.js');

const CATEGORY_MAP = {
  racket: { label: '球拍类', emoji: '🏸' },
  ball:   { label: '球类',   emoji: '⚽' },
  shoe:   { label: '鞋服',   emoji: '👟' },
  other:  { label: '其他',   emoji: '🎽' }
};

Page({
  data: { id: '', equip: null, isOwner: false, borrowing: false, defaultAvatar: '/images/icons/avatar.png' },
  onLoad(query) { this.setData({ id: query.id }); this.fetch(); },

  async fetch() {
    try {
      const resp = await callCloud('equipment', { type: 'detail', id: this.data.id });
      if (resp.result && resp.result.success) {
        const e = resp.result.data;
        const me = (app.globalData.userInfo && app.globalData.userInfo._openid) || '';
        this.setData({
          // 关键：不用 { ...e, ... } 对象 spread → Babel helper 问题,改用 Object.assign
          equip: Object.assign({}, e, {
            categoryLabel: (CATEGORY_MAP[e.category] || {}).label || e.category,
            categoryEmoji: (CATEGORY_MAP[e.category] || {}).emoji || '🎽',
            createdAtText: this._fmt(e.createdAt)
          }),
          isOwner: me && e._openid === me
        });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  _fmt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  async onBorrow() {
    if (this.data.borrowing) return;
    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      userInfo = await app.loginSilently();
      wx.hideLoading();
    }
    if (!userInfo || !userInfo._openid) return wx.showModal({ title: '提示', content: '请先登录', showCancel: false });

    // 简单弹窗让用户输入租借天数
    this.setData({ borrowing: true });
    try {
      const prompt = await new Promise((resolve) => {
        wx.showModal({
          title: '发起租借',
          content: '确认发起租借申请？租借天数由发布者确认后生效。',
          success: (res) => resolve(res.confirm)
        });
      });
      if (!prompt) { this.setData({ borrowing: false }); return; }

      const resp = await callCloud('equipment', {
        type: 'borrow',
        payload: { equipId: this.data.id, days: 1, nickName: userInfo.nickName || '拾球记用户' }
      });
      this.setData({ borrowing: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '租借成功', icon: 'success' });
        setTimeout(() => wx.navigateTo({ url: '/pages/equipment/my' }), 800);
      } else {
        const code = (resp.result && resp.result.errCode) || '';
        const map = { OWN_ITEM: '不能租借自己发布的', UNAVAILABLE: '该器材暂不可借' };
        wx.showToast({ title: map[code] || (resp.result && resp.result.errMsg) || '租借失败', icon: 'none' });
      }
    } catch (e) {
      this.setData({ borrowing: false });
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  onTapMyBorrows() { wx.navigateTo({ url: '/pages/equipment/my' }); }
});
