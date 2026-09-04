// pages/ball/detail.js
// 约球帖子详情页
// 职责：
//   1. 根据 id 拉取帖子详情
//   2. 判断当前用户身份（创建者 / 已加入 / 未加入 / 关闭）
//   3. 提供申请入队 / 取消入队 / 关闭招募 / 删除帖子 4 个动作
//
// 性能优化：
//   onLoad 通过 eventChannel 拿列表里已有的 item 立即渲染，
//   再异步 fetchDetail 拿最新 joinedUsers 等增量，避免冷启动等待

const app = getApp();
const { callCloud } = require('../../utils/cloud.js');

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
    confirming: false,   // 确认完成按钮 loading
    hasReminder: false,  // 当前用户是否已开启「提前 2 小时提醒」
    remindAtText: '',    // 提醒时间显示文案（mm/dd HH:mm 推送）
    canShowReminder: false, // 是否展示提醒行（仅 creator / joined 显示）
    defaultAvatar: '/images/icons/avatar.png'
  },

  async onLoad(query) {
    const id = (query && query.id) || '';
    if (!id) {
      wx.showToast({ title: '参数错误', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
      return;
    }
    this.setData({ id });

    // 关键：等静默登录完成，确保 userInfo._openid 已就绪
    // 否则 isCreator / isJoined 会因 openid 缺失而错判 → 看到「申请入队」按钮
    const appInst = getApp();
    if (!appInst.globalData.userInfo || !appInst.globalData.userInfo._openid) {
      try { await appInst.loginSilently(); } catch (e) { /* 静默 */ }
    }

    // 关键：拿列表页通过 eventChannel 传过来的 item 立即渲染
    // （列表页本来就有 sport/time/location/needCount 等大部分字段）
    // 不再等云函数冷启动
    const channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
    if (channel && channel.on) {
      channel.on('post', (item) => {
        if (item && item._id === id) {
          this._renderPost(item);
        }
      });
    }

    // 异步拉服务器最新数据（主要是 joinedUsers 成员列表）
    this.fetchDetail();
    // 异步拉自己的提醒状态
    this.fetchReminderStatus();
  },

  // 把 post 渲染到 data（含身份判断）
  _renderPost(post) {
    const mapped = this._mapPost(post);
    const myOpenid = (app.globalData.userInfo && app.globalData.userInfo._openid) || '';
    const isCreator = myOpenid && mapped._openid === myOpenid;
    const isJoined = myOpenid && (mapped.joinedUsers || []).some((u) => u.openid === myOpenid);
    // 提醒行仅创建者 / 已加入者可见（普通用户未参与该约球，不应展示）
    const canShowReminder = isCreator || isJoined;
    this.setData({ post: mapped, isCreator, isJoined, canShowReminder });
  },

  // 字段映射：复用 list 里的语义
  // 关键：不用 { ...post, ... } 对象 spread → 在该 Babel 配置下会触发
  //        @babel/runtime/helpers/arrayWithHoles 的 require 调用,
  //        改用 Object.assign 达到同样效果
  _mapPost(post) {
    const sport = SPORT_MAP[post.sport] || { label: post.sport, emoji: '🏅' };
    const eff = post.effectiveStatus || post.status || 'open';
    const progress = Math.min(
      Math.round(((post.currentCount || 1) / (post.needCount || 1)) * 100),
      100
    );
    return Object.assign({}, post, {
      sportLabel: sport.label,
      sportEmoji: sport.emoji,
      scopeLabel: SCOPE_MAP[post.scope] || '全校同学',
      effectiveStatus: eff,
      progress,
      createdAtText: this._formatDateTime(post.createdAt),
      deadlineText: this._formatDeadline(post.recruitDeadline),
      countdownText: this._formatCountdown(post.secondsLeft)
    });
  },

  _formatDeadline(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  },

  _formatCountdown(secondsLeft) {
    if (!secondsLeft || secondsLeft <= 0) return '';
    if (secondsLeft < 60) return '剩 <1分钟';
    if (secondsLeft < 3600) return `剩 ${Math.floor(secondsLeft / 60)} 分钟`;
    if (secondsLeft < 86400) {
      const h = Math.floor(secondsLeft / 3600);
      const m = Math.floor((secondsLeft % 3600) / 60);
      return `剩 ${h}小时${m > 0 ? m + '分' : ''}`;
    }
    const d = Math.floor(secondsLeft / 86400);
    const h = Math.floor((secondsLeft % 86400) / 3600);
    return `剩 ${d}天${h}小时`;
  },

  _formatDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  },

  // 拉取详情 + 判断身份（异步刷新，不阻塞首屏）
  async fetchDetail() {
    try {
      const resp = await callCloud('ballAdd', { type: 'detail', id: this.data.id });
      if (resp.result && resp.result.success) {
        this._renderPost(resp.result.data);
      } else {
        wx.showToast({
          title: (resp.result && resp.result.errMsg) || '加载失败',
          icon: 'none'
        });
      }
    } catch (e) {
      // 已在 callCloud 内部打日志，这里只提示
      wx.showToast({ title: '调用失败，请看控制台', icon: 'none' });
    }
  },

  // 拉取当前用户对该 post 的提醒状态
  // 做法：拉 myReminders（全量 pending），按 postId 匹配；一个人最多几十条记录，量小
  async fetchReminderStatus() {
    const post = this.data.post;
    if (!post || !post._id) return; // post 还没拿到时不查
    try {
      const r = await callCloud('ballReminder', { type: 'myReminders' });
      if (r.result && r.result.success) {
        const list = r.result.data.list || [];
        const hit = list.find((x) => x.postId === post._id);
        this.setData({
          hasReminder: !!hit,
          remindAtText: hit ? this._formatRemindAt(hit.remindAt) : ''
        });
      }
    } catch (e) {
      // 静默：拉取失败不影响主流程
    }
  },

  _formatRemindAt(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())} 推送`;
  },

  // 切换提醒：弹订阅授权（开启）或直接调 cancelReminder（关闭）
  async onToggleReminder() {
    const post = this.data.post;
    if (!post) return;
    // 登录态校验
    const userInfo = app.globalData.userInfo || {};
    const openid = userInfo._openid || '';
    if (!openid) {
      return wx.showToast({ title: '请先登录', icon: 'none' });
    }
    // 身份判断
    let recipientKind = null;
    if (post._openid === openid) recipientKind = 'creator';
    else if ((post.joinedUsers || []).some((u) => u.openid === openid)) recipientKind = 'joiner';
    else {
      return wx.showToast({ title: '请先加入该约球', icon: 'none' });
    }
    // 帖子状态校验
    if (post.status === 'closed') return wx.showToast({ title: '该帖已关闭', icon: 'none' });
    if (post.effectiveStatus === 'expired') return wx.showToast({ title: '该帖已过期', icon: 'none' });

    const { optInReminder, optOutReminder } = require('../../utils/reminder.js');
    if (this.data.hasReminder) {
      const ok = await optOutReminder(post._id);
      if (ok) this.setData({ hasReminder: false, remindAtText: '' });
    } else {
      const r = await optInReminder({ postId: post._id, recipientKind: recipientKind });
      if (r && r.ok) this.fetchReminderStatus();
    }
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

    // 关键：前端防御 —— 不能申请自己的帖子
    // 万一 isCreator 错判（openid 未就绪时），也至少在本方法里再挡一次
    const post2 = this.data.post;
    const myOpenid2 = (app2.globalData.userInfo && app2.globalData.userInfo._openid) || '';
    if (post2 && post2._openid && myOpenid2 && post2._openid === myOpenid2) {
      return wx.showToast({ title: '不能加入自己发起的约球', icon: 'none' });
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
        // 刷新提醒状态（刚入队，可能会自己主动开启提醒）
        this.fetchReminderStatus();
      } else {
        const errMap = {
          OWN_POST: '不能加入自己发起的约球',
          CLOSED: '该帖已关闭招募',
          EXPIRED: '招募已截止',
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
        this.fetchReminderStatus();
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
        this.fetchReminderStatus();
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

  // ============ 动作：确认完成（满员后创建者点同意） ============
  // 关键：满员才能确认；改 status='completed' → 广场不再展示
  // 提醒**不**取消（活动仍要进行，2h 前仍需提醒）
  async onConfirmComplete() {
    if (this.data.confirming) return;
    const post = this.data.post;
    if (!post) return;
    // 二次确认
    const confirmed = await this._confirm(
      '确认凑齐队员了吗？\n确认后该约球将从广场移除，但您和参与者仍能在「我的」中看到。'
    );
    if (!confirmed) return;

    this.setData({ confirming: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type: 'confirmComplete', id: this.data.id }
      });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '已完成招募', icon: 'success' });
        // 刷新详情，状态会变成 completed
        this.fetchDetail();
        this.fetchReminderStatus();
      } else {
        const code = (resp.result && resp.result.errCode) || '';
        const errMap = {
          FORBIDDEN: '只有发起人可以确认',
          NOT_FULL: '人员未凑齐',
          ALREADY_COMPLETED: '该帖已是已完成状态',
          CLOSED: '该帖已关闭',
          NOT_FOUND: '帖子不存在'
        };
        wx.showToast({
          title: errMap[code] || (resp.result && resp.result.errMsg) || '确认失败',
          icon: 'none'
        });
      }
    } catch (e) {
      console.error('[ball detail] confirmComplete failed', e);
      wx.showToast({ title: '网络异常', icon: 'none' });
    } finally {
      this.setData({ confirming: false });
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
