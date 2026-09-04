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
    //   留空时自动使用 IDE 当前选中的云开发环境（推荐）
    env: "cloud1-d2g9i0g5g696e783a",

    // 用户信息：登录完成后填充
    // _openid 来自云函数，是用户在当前小程序的唯一标识
    // nickName / avatarUrl 来自用户主动授权，可能为空
    userInfo: null
  },

  onLaunch() {
    // ====== 主动诊断：让控制台一定有内容 ======
    console.log('========================================');
    console.log('[拾球记] App 启动');
    console.log('[拾球记] wx.cloud 类型:', typeof wx.cloud);
    console.log('[拾球记] env 配置:', this.globalData.env || '(空，将使用默认)');
    console.log('========================================');

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
      return;
    }
    // 关键修复：如果 env 为空字符串，不传 env 参数
    const initOptions = { traceUser: true };
    if (this.globalData.env) {
      initOptions.env = this.globalData.env;
    }
    wx.cloud.init(initOptions);
    console.log('[拾球记] wx.cloud.init 完成');

    // 静默登录：拉取 openid
    this.loginSilently();

    // 主动测试 5 个云函数，把结果打印到控制台
    this._runDiagnostics();
  },

  /**
   * App.onShow：用户从后台切回 / 冷启动 都会触发
   *   用于「提前 2 小时提醒」消息拉取
   *   等静默登录完成再拉（依赖 openid）
   */
  onShow() {
    // 等待 openid 拿到后再调；loginSilently 已是 Promise，可在 then 里串接
    this.loginSilently()
      .then(() => this._checkPendingReminders())
      .catch(() => {});
  },

  /**
   * App.onShow 也会调：从「消息中心」拉取 status='ready' 的提醒
   * 逐条弹 wx.showModal，用户点「去看看」跳详情，点「知道了」或关闭即标 read
   *
   * 防重入：用一个标志位，避免 onShow 多次触发时并发弹窗
   * 防循环：每处理一条都立即 markRead，下次循环就不会再拿到
   */
  async _checkPendingReminders() {
    if (this._checkingReminders) return;
    this._checkingReminders = true;
    try {
      while (true) {
        // 懒加载：避免冷启动一次性 require 全部 utils
        const { callCloud } = require('./utils/cloud.js');
        let r;
        try {
          r = await callCloud('ballReminder', { type: 'pendingReads' });
        } catch (e) {
          break;
        }
        if (!r || !r.result || !r.result.success) break;
        const list = (r.result.data && r.result.data.list) || [];
        if (list.length === 0) break;
        // 只处理第一条，避免一次弹多个 modal 卡住用户
        const first = list[0];
        const goDetail = await this._showReminderModal(first);
        // 不论用户点哪个按钮，都先标 read（防止下次 onShow 再弹）
        try {
          await callCloud('ballReminder', { type: 'markRead', id: first._id });
        } catch (e) { /* 静默 */ }
        // 「去看看」→ 跳详情
        if (goDetail && first.postId) {
          wx.navigateTo({ url: '/pages/ball/detail?id=' + first.postId });
          // 已跳转，本次循环结束（避免在详情页继续弹）
          break;
        }
      }
    } catch (e) {
      console.error('[app] _checkPendingReminders error', e);
    } finally {
      this._checkingReminders = false;
    }
  },

  /**
   * 弹单个提醒的 modal，返回 Promise<boolean: 是否点「去看看」>
   */
  _showReminderModal(reminder) {
    return new Promise((resolve) => {
      // 兜底：极少数情况下 reminder 缺字段
      const sport = reminder.sportLabel || '约球';
      const time  = reminder.time || reminder.postTime || '';
      const loc   = reminder.location || '';
      const content = sport + ' 约球将在 2 小时后开始\n\n'
        + '🕐 ' + time + '\n'
        + '📍 ' + loc;
      wx.showModal({
        title: '🔔 约球提醒',
        content: content,
        confirmText: '去看看',
        cancelText: '知道了',
        success: (res) => resolve(!!res.confirm),
        fail: () => resolve(false)
      });
    });
  },

  /**
   * 主动诊断：依次调用 5 个云函数
   * 只要小程序启动，控制台就会有清晰的成功/失败日志
   * 这样排查"云函数未部署"问题有明确依据
   */
  _runDiagnostics() {
    const fns = ['login', 'ballAdd', 'venue', 'equipment', 'moment'];
    let done = 0;
    console.log('[诊断] 开始测试 5 个云函数...');
    fns.forEach((name) => {
      const t0 = Date.now();
      wx.cloud.callFunction({ name, data: { type: 'list' } })
        .then((r) => {
          const cost = Date.now() - t0;
          console.log(`[诊断] ✅ ${name} (${cost}ms)`, r.result || r);
        })
        .catch((e) => {
          const cost = Date.now() - t0;
          console.error(`[诊断] ❌ ${name} (${cost}ms) 错误:`, {
            errMsg: e.errMsg || e.message,
            errCode: e.errCode,
            hint: this._cloudHint(e)
          });
        })
        .finally(() => {
          done++;
          if (done === fns.length) {
            console.log('[诊断] 测试结束 ✅ 详情见上方');
          }
        });
    });
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
          console.log("[app] 静默登录成功 openid:", openid.slice(0, 6) + "***");
          return this.globalData.userInfo;
        }
        console.warn("[app] 静默登录返回失败", resp);
        return null;
      })
      .catch((err) => {
        // 关键修复：打印详细错误，方便定位"云函数未部署"的真实原因
        console.error("[app] 静默登录失败:", {
          errMsg: err.errMsg || err.message,
          errCode: err.errCode,
          hint: this._cloudHint(err)
        });
        return null;
      });
  },

  /**
   * 根据错误对象给出针对性排查提示
   * 让开发者一眼看出"为什么云函数调不通"
   */
  _cloudHint(err) {
    const msg = (err && (err.errMsg || err.message)) || "";
    if (msg.includes("FunctionName parameter could not be found") || msg.includes("-501000")) {
      return "❌ 云函数未上传或名字拼错：右键 cloudfunctions/<name> 选择「上传并部署：云端安装依赖」";
    }
    if (msg.includes("Environment not found") || msg.includes("env not exists")) {
      return "❌ env 不存在：在 app.js 第 17 行填入正确的环境 ID，或在 IDE 顶部云开发面板确认环境存在";
    }
    if (msg.includes("cloud has not been initialized")) {
      return "❌ 云开发未初始化：检查基础库版本 ≥ 2.2.3，且在 project.config.json 配置了云开发";
    }
    if (msg.includes("wx.cloud is not a function")) {
      return "❌ wx.cloud 不可用：基础库版本过低，请在 project.config.json 升级 libVersion";
    }
    if (msg.includes("-504002") || msg.includes("functions execute fail")) {
      return "❌ 云函数在云端运行时报错：打开微信开发者工具 → 顶部「云开发」→ 云函数 → 选中该函数 → 「日志」页签，查看真实堆栈";
    }
    if (msg.includes("-502005") || msg.includes("database collection not exists")) {
      return "❌ 集合不存在：在云开发面板 → 数据库手动创建该集合，或确认 ensureCollection 已生效";
    }
    if (msg.includes("uploadFile:fail") || msg.includes("fail to fetch")) {
      return "❌ 网络异常或云函数运行时报错：查看云开发面板 → 云函数 → 日志";
    }
    return "💡 查看微信开发者工具控制台 + 云开发 → 云函数 → 日志 定位详细原因";
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
            // 关键：不用 { ...cached, ...res.userInfo } 对象 spread → 在该 Babel 配置下
            //        会触发 @babel/runtime/helpers/arrayWithHoles 的 require 调用,
            //        改用 Object.assign 达到同样效果
            this.globalData.userInfo = Object.assign({}, cached, res.userInfo);
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
