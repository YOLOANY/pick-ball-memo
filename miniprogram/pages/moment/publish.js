// pages/moment/publish.js
// 流程：选图 → 上传到云存储 → 把 fileID 列表提交到 moment 云函数
const app = getApp();
const { callCloud } = require('../../utils/cloud.js');

Page({
  data: {
    form: { content: '', images: [], sport: 'other', mood: '😊', location: '' },
    sportList: [
      { value: 'tennis',     label: '网球',   emoji: '🎾' },
      { value: 'basketball', label: '篮球',   emoji: '🏀' },
      { value: 'badminton',  label: '羽毛球', emoji: '🏸' },
      { value: 'football',   label: '足球',   emoji: '⚽' },
      { value: 'pingpong',   label: '乒乓球', emoji: '🏓' },
      { value: 'volleyball', label: '排球',   emoji: '🏐' },
      { value: 'other',      label: '其他',   emoji: '🏃' }
    ],
    moodList: ['😊', '😄', '😍', '🤩', '💪', '🔥', '😎', '🥰', '😴', '😢'],
    submitting: false
  },

  onInput(e) {
    // 关键：value 在 e.detail.value，data-field 在 e.currentTarget.dataset
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({ [`form.${field}`]: value });
  },
  onSelectSport(e) { this.setData({ 'form.sport': e.currentTarget.dataset.value }); },
  onSelectMood(e) { this.setData({ 'form.mood': e.currentTarget.dataset.mood }); },

  // 选择本地图片
  onPickImage() {
    const remain = 9 - this.data.form.images.length;
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      sizeType: ['compressed'],
      success: (res) => {
        const files = res.tempFiles || [];
        this._uploadAll(files);
      }
    });
  },

  // 把临时文件一个个上传到云存储
  async _uploadAll(files) {
    wx.showLoading({ title: `上传中 0/${files.length}`, mask: true });
    const uploaded = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const f = files[i];
        const ext = (f.tempFilePath.match(/\.(\w+)$/) || [])[1] || 'jpg';
        const cloudPath = `moments/${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
        const up = await wx.cloud.uploadFile({ cloudPath, filePath: f.tempFilePath });
        uploaded.push(up.fileID);
        wx.showLoading({ title: `上传中 ${uploaded.length}/${files.length}`, mask: true });
      } catch (e) {
        console.error('[moment] upload error', e);
      }
    }
    wx.hideLoading();
    // 关键：不用 [...a, ...b] 数组 spread → Babel helper 问题,改用 concat
    this.setData({ 'form.images': (this.data.form.images || []).concat(uploaded) });
  },

  onDelImage(e) {
    const idx = e.currentTarget.dataset.index;
    const images = this.data.form.images.slice();
    images.splice(idx, 1);
    this.setData({ 'form.images': images });
  },

  async onSubmit() {
    if (this.data.submitting) return;
    const f = this.data.form;
    if (!f.content.trim()) return wx.showToast({ title: '请输入内容', icon: 'none' });

    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      userInfo = await app.loginSilently();
      wx.hideLoading();
    }
    if (!userInfo || !userInfo._openid) return wx.showModal({ title: '提示', content: '请先登录', showCancel: false });

    const profile = await app.ensureUserProfile();
    userInfo = profile || userInfo;

    this.setData({ submitting: true });
    try {
      const resp = await callCloud('moment', {
        type: 'publish',
        payload: {
          content: f.content.trim(),
          images: f.images,
          sport: f.sport,
          mood: f.mood,
          location: f.location.trim(),
          nickName: userInfo.nickName || '拾球记用户',
          avatarUrl: userInfo.avatarUrl || ''
        }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' });
        setTimeout(() => wx.redirectTo({ url: '/pages/moment/list' }), 800);
      } else {
        wx.showModal({ title: '发布失败', content: (resp.result && resp.result.errMsg) || '请稍后重试', showCancel: false });
      }
    } catch (e) {
      this.setData({ submitting: false });
      wx.showModal({ title: '发布失败', content: '云函数调用失败，请看控制台日志', showCancel: false });
    }
  }
});
