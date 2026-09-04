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
  },

  // 把 post 渲染到 data（含身份判断）
  _renderPost(post) {
    const mapped = this._mapPost(post);
    const myOpenid = (app.globalData.userInfo && app.globalData.userInfo._openid) || '';
    const isCreator = myOpenid && mapped._openid === myOpenid;
    const isJoined = myOpenid && (mapped.joinedUsers || []).some((u) => u.openid === myOpenid);
    this.setData({ post: mapped, isCreator, isJoined });
  },

  // 字段映射：复用 list 里的语义
  _mapPost(post) {
    const sport = SPORT_MAP[post.sport] || { label: post.sport, emoji: '🏅' };
    const eff = post.effectiveStatus || post.status || 'open';
    const progress = Math.min(
      Math.round(((post.currentCount || 1) / (post.needCount || 1)) * 100),
      100
    );
    return {
      ...post,
      sportLabel: sport.label,
      sportEmoji: sport.emoji,
      scopeLabel: SCOPE_MAP[post.scope] || '全校同学',
      effectiveStatus: eff,
      progress,
      createdAtText: this._formatDateTime(post.createdAt),
      deadlineText: this._formatDeadline(post.recruitDeadline),
      countdownText: this._formatCountdown(post.secondsLeft)
    };
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
