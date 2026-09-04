// pages/index/index.js
// 首页：仅作模块入口，点击跳到对应广场页
// 注意：ball/list 是 tabBar 页面（app.json:40），必须用 switchTab；其他用 navigateTo
const TAB_BAR_PAGES = ['/pages/index/index', '/pages/ball/list', '/pages/mine/index'];

Page({
  data: {},
  onNav(e) {
    const url = e.currentTarget.dataset.url;
    if (TAB_BAR_PAGES.includes(url)) {
      wx.switchTab({ url });
    } else {
      wx.navigateTo({ url });
    }
  }
});
