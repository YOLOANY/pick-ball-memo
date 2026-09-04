// app.js
// 全局应用入口
// 职责：
//   1. 初始化云开发
//   2. 静默登录：调 login 云函数拿到 openid，存到 globalData.userInfo
//   3. 暴露 ensureUserProfile 方法，业务页在需要时调用，主动拉取用户昵称头像
//
// 静默登录 vs 授权登录：
//   静默登录：只拿 openid，**不需要用户点击任何按钮**，进入小程序即完成
//   授权登录：调用 wx.getUserProfile 必须由用户主动触发（button open-type="chooseAvatar" 等）

App({
  globalData: {
    // env 参数说明：
    //   env 参数决定接下来小程序发起的云开发调用（wx.cloud.xxx）会请求到哪个云环境的资源
    //   此处请填入环境 ID, 环境 ID 可在微信开发者工具右上顶部工具栏点击云开发按钮打开获取
    env: "",

    // 用户信息：登录完成后填充
    // _openid 来自云函数，是用户在当前小程序的唯一标识
    // nickName / avatarUrl 来自用户主动授权，可能为空
    userInfo: null
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }
    wx.cloud.init({
      env: this.globalData.env,
      traceUser: true
    });
    // 静默登录：拉取 openid
    this.loginSilently();
  },

  /**
   * 静默登录
   * 调用 cloud function 'login' 拿到当前用户的 openid
   * 用户无需任何操作，失败也只 console 提示，不阻塞业务
   */
  loginSilently() {
    // 已有 openid 直接返回
    if (this.globalData.userInfo && this.globalData.userInfo._openid) {
      return Promise.resolve(this.globalData.userInfo);
    }
    return wx.cloud
      .callFunction({ name: "login" })
      .then((resp) => {
        if (resp && resp.result && resp.result.success) {
          const { openid } = resp.result.data;
          this.globalData.userInfo = {
            _openid: openid,
            nickName: this.globalData.userInfo && this.globalData.userInfo.nickName,
            avatarUrl: this.globalData.userInfo && this.globalData.userInfo.avatarUrl
          };
          return this.globalData.userInfo;
        }
        console.warn("[app] 静默登录返回失败", resp);
        return null;
      })
      .catch((err) => {
        console.error("[app] 静默登录失败，请确认已上传 cloudfunctions/login", err);
        return null;
      });
  },

  /**
   * 主动获取用户昵称头像
   * 由业务页面（如 publish）在提交前调用，会弹一次授权框
   * 成功后写入 globalData.userInfo
   * 返回 Promise<userInfo | null>
   *
   * 注意：基础库 2.27+ 已废弃 wx.getUserInfo，改用 button open-type="chooseAvatar"
   *      这里用兼容写法：先尝试 getUserProfile，失败再降级到默认头像
   */
  ensureUserProfile() {
    const cached = this.globalData.userInfo || {};
    if (cached.nickName && cached.avatarUrl) {
      return Promise.resolve(cached);
    }
    return new Promise((resolve) => {
      // 优先尝试新版 API
      if (wx.getUserProfile) {
        wx.getUserProfile({
          desc: "用于完善约球帖子里的昵称头像",
          success: (res) => {
            this.globalData.userInfo = {
              ...cached,
              ...res.userInfo
            };
            resolve(this.globalData.userInfo);
          },
          fail: () => resolve(cached)
        });
      } else {
        // 降级：什么都不做，沿用 openid
        resolve(cached);
      }
    });
  }
});
