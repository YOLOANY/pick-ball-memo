// pages/index/index.js
// 首页：仅作模块入口，点击跳到对应广场页
Page({
  data: {},
  onNav(e) {
    const url = e.currentTarget.dataset.url;
    // 首页所有目标页面都是非 tabBar 页面，用 navigateTo
    wx.navigateTo({ url });
  }
});
