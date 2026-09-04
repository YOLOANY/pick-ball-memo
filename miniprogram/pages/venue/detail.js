// pages/venue/detail.js
// 场地详情 + 预约表单
const app = getApp();
const SPORT_MAP = {
  tennis: { emoji: '🎾' }, basketball: { emoji: '🏀' },
  badminton: { emoji: '🏸' }, football: { emoji: '⚽' },
  pingpong: { emoji: '🏓' }, volleyball: { emoji: '🏐' }
};
const SLOTS = ['08:00-10:00', '10:00-12:00', '14:00-16:00', '16:00-18:00', '19:00-21:00'];

Page({
  data: {
    id: '',
    venue: null,
    form: { date: '', timeSlot: '', hours: 1, contact: '', remark: '' },
    today: '',
    totalPrice: 0,
    submitting: false
  },

  onLoad(query) {
    const today = this._formatDate(new Date());
    this.setData({ id: query.id, today });
    this.fetch();
  },

  async fetch() {
    try {
      const resp = await wx.cloud.callFunction({ name: 'venue', data: { type: 'detail', id: this.data.id } });
      if (resp.result && resp.result.success) {
        const v = resp.result.data;
        this.setData({
          venue: { ...v, sportEmoji: (SPORT_MAP[v.sport] || {}).emoji || '🏅' }
        });
      } else {
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    } catch (e) {
      wx.showToast({ title: '云函数未部署', icon: 'none' });
    }
  },

  _formatDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  onPickDate(e) { this.setData({ 'form.date': e.detail.value }); this._recalc(); },
  onPickSlot() {
    wx.showActionSheet({
      itemList: SLOTS,
      success: (res) => {
        this.setData({ 'form.timeSlot': SLOTS[res.tapIndex] });
        this._recalc();
      }
    });
  },
  onHoursPlus() {
    if (this.data.form.hours >= 4) return wx.showToast({ title: '最多 4 小时', icon: 'none' });
    this.setData({ 'form.hours': this.data.form.hours + 1 });
    this._recalc();
  },
  onHoursMinus() {
    if (this.data.form.hours <= 1) return;
    this.setData({ 'form.hours': this.data.form.hours - 1 });
    this._recalc();
  },
  onInput(e) {
    const { field, value } = e.detail;
    this.setData({ [`form.${field}`]: value });
  },
  _recalc() {
    const v = this.data.venue;
    if (!v) return;
    this.setData({ totalPrice: (v.price || 0) * this.data.form.hours });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const { form, venue } = this.data;
    if (!form.date) return wx.showToast({ title: '请选择日期', icon: 'none' });
    if (!form.timeSlot) return wx.showToast({ title: '请选择时段', icon: 'none' });
    if (form.hours < 1) return wx.showToast({ title: '请选择时长', icon: 'none' });

    // 登录态
    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      userInfo = await app.loginSilently();
      wx.hideLoading();
    }
    if (!userInfo || !userInfo._openid) {
      return wx.showModal({ title: '提示', content: '请先登录', showCancel: false });
    }

    this.setData({ submitting: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'venue',
        data: {
          type: 'order',
          payload: {
            venueId: this.data.id,
            date: form.date,
            timeSlot: form.timeSlot,
            hours: form.hours,
            contact: form.contact.trim(),
            remark: form.remark.trim(),
            nickName: userInfo.nickName || '拾球记用户'
          }
        }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '预约成功', icon: 'success' });
        setTimeout(() => wx.navigateTo({ url: '/pages/venue/my' }), 800);
      } else {
        wx.showModal({ title: '预约失败', content: (resp.result && resp.result.errMsg) || '请稍后重试', showCancel: false });
      }
    } catch (e) {
      this.setData({ submitting: false });
      wx.showModal({ title: '预约失败', content: '云函数未部署或网络异常', showCancel: false });
    }
  },

  onTapMyOrders() { wx.navigateTo({ url: '/pages/venue/my' }); }
});
