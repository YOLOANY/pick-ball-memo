// pages/ball/publish.js
// 约球帖子发布页逻辑
// 职责：
//   1. 维护表单数据 formData
//   2. 提供项目 / 时间 / 人数 / 招募范围等交互
//   3. 提交时进行基础校验，再调用 ballAdd 云函数写入云数据库 ball_posts 集合

const app = getApp();

Page({
  data: {
    // 表单数据：所有用户输入最终汇总到这里
    formData: {
      sport: '',            // 运动项目枚举：tennis / basketball / ...
      time: '',             // 约球时间（已格式化的字符串）
      location: '',         // 地点
      needCount: 2,         // 需要人数（不含发起人）
      scope: 'all',         // 招募范围：all / college / grade
      contact: '',          // 联系方式（选填）
      remark: '',           // 备注说明
      recruitDeadline: 0,        // 招募截止时间戳（毫秒）；0 = 不自动截止
      recruitDeadlineText: ''   // 招募截止时间显示文案
    },

    // 运动项目可选列表
    // emoji 字段只用于前端展示，提交到数据库时只保留 value
    sportList: [
      { value: 'tennis',     label: '网球',   emoji: '🎾' },
      { value: 'basketball', label: '篮球',   emoji: '🏀' },
      { value: 'badminton',  label: '羽毛球', emoji: '🏸' },
      { value: 'football',   label: '足球',   emoji: '⚽' },
      { value: 'pingpong',   label: '乒乓球', emoji: '🏓' },
      { value: 'volleyball', label: '排球',   emoji: '🏐' }
    ],

    // 招募范围
    scopeList: [
      { value: 'all',     label: '全校同学' },
      { value: 'college', label: '本院同学' },
      { value: 'grade',   label: '同年级'   }
    ],

    // 提交中状态：用于控制按钮 loading
    submitting: false
  },

  // ============ 生命周期 ============
  onLoad() {
    // 默认选中第一个运动项目，给用户一个友好起点
    this.setData({
      'formData.sport': this.data.sportList[0].value
    });
  },

  // ============ 表单交互 ============
  // 选中运动项目
  onSelectSport(e) {
    const { value } = e.currentTarget.dataset;
    this.setData({ 'formData.sport': value });
  },

  // 选中招募范围
  onSelectScope(e) {
    const { value } = e.currentTarget.dataset;
    this.setData({ 'formData.scope': value });
  },

  // 通用 input / textarea 输入处理
  // 关键：value 在 e.detail.value，data-field 在 e.currentTarget.dataset
  onInputChange(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({ [`formData.${field}`]: value });
  },

  // 兜底：blur 时也同步一次，防止某些情况 bindinput 不触发
  onInputBlur(e) {
    const { field } = e.currentTarget.dataset;
    const value = e.detail.value;
    if (value !== undefined) {
      this.setData({ [`formData.${field}`]: value });
    }
  },

  // 人数 +1
  onCountPlus() {
    const cur = this.data.formData.needCount;
    if (cur >= 20) {
      wx.showToast({ title: '最多招募 20 人', icon: 'none' });
      return;
    }
    this.setData({ 'formData.needCount': cur + 1 });
  },

  // 人数 -1
  onCountMinus() {
    const cur = this.data.formData.needCount;
    if (cur <= 1) return;
    this.setData({ 'formData.needCount': cur - 1 });
  },

  // 选择时间：先选日期，再选时间
  onPickDateTime() {
    // 第一步：选择日期
    wx.showActionSheet({
      itemList: ['今天', '明天', '后天', '自定义日期'],
      success: (res) => {
        const now = new Date();
        let date;
        if (res.tapIndex === 0) {
          date = this._formatDate(now);
        } else if (res.tapIndex === 1) {
          now.setDate(now.getDate() + 1);
          date = this._formatDate(now);
        } else if (res.tapIndex === 2) {
          now.setDate(now.getDate() + 2);
          date = this._formatDate(now);
        } else {
          // 自定义：调起 wx picker
          this._pickDate();
          return;
        }
        // 选完日期后立即选时间
        this._pickTime(date);
      }
    });
  },

  // 调起日期选择器
  _pickDate(datePrefix) {
    wx.showActionSheet({
      itemList: ['使用日期选择器'],
      success: () => {
        // 小程序原生不支持直接 dateTime picker，用 actionSheet 引导
        // 实际项目中可使用 picker 组件
        wx.showToast({ title: '请使用快捷日期', icon: 'none' });
      }
    });
  },

  // 调起时间选择
  _pickTime(datePrefix) {
    wx.showActionSheet({
      itemList: ['08:00', '10:00', '14:00', '16:00', '19:00', '20:00'],
      success: (res) => {
        const times = ['08:00', '10:00', '14:00', '16:00', '19:00', '20:00'];
        const time = times[res.tapIndex];
        this.setData({ 'formData.time': `${datePrefix} ${time}` });
      }
    });
  },

  // ============ 招募截止时间（两步：先日期再时间） ============
  onPickDeadline() {
    wx.showActionSheet({
      itemList: ['今天', '明天', '后天', '3 天后', '7 天后'],
      success: (res) => {
        const map = { 0: 0, 1: 1, 2: 2, 3: 3, 4: 7 };
        const days = map[res.tapIndex];
        if (days === undefined) return;
        const d = new Date();
        d.setDate(d.getDate() + days);
        const datePrefix = this._formatDate(d);
        this._pickDeadlineTime(datePrefix);
      },
      fail: () => {}
    });
  },

  _pickDeadlineTime(datePrefix) {
    wx.showActionSheet({
      itemList: ['08:00', '10:00', '12:00', '14:00', '18:00', '20:00', '22:00'],
      success: (res) => {
        const times = ['08:00', '10:00', '12:00', '14:00', '18:00', '20:00', '22:00'];
        const time = times[res.tapIndex];
        const ts = new Date(`${datePrefix} ${time}:00`).getTime();
        if (!Number.isFinite(ts)) {
          return wx.showToast({ title: '时间格式错误', icon: 'none' });
        }
        if (ts <= Date.now()) {
          return wx.showToast({ title: '截止时间必须在未来', icon: 'none' });
        }
        this.setData({
          'formData.recruitDeadline': ts,
          'formData.recruitDeadlineText': `${datePrefix} ${time}`
        });
      },
      fail: () => {}
    });
  },

  onClearDeadline() {
    this.setData({
      'formData.recruitDeadline': 0,
      'formData.recruitDeadlineText': ''
    });
  },

  // 将 Date 格式化为 YYYY-MM-DD
  _formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // ============ 提交 ============
  async onSubmit() {
    if (this.data.submitting) return;

    const { formData } = this.data;

    // 调试：打印真实表单数据
    console.log('[publish] 提交时表单数据:', JSON.stringify(formData, null, 2));

    // 1) 基础校验
    if (!formData.sport) {
      return wx.showToast({ title: '请选择运动项目', icon: 'none' });
    }
    if (!formData.time) {
      return wx.showToast({ title: '请选择约球时间', icon: 'none' });
    }
    if (!formData.location || !formData.location.trim()) {
      // 把实际值也提示出来，方便排查
      return wx.showModal({
        title: '请填写地点',
        content: '当前 location 字段值：\n[' + (formData.location || '(空)') + ']\n\n请确保在"地点"输入框中输入了真实文字。',
        showCancel: false,
        confirmText: '去填写'
      });
    }
    if (formData.needCount < 1) {
      return wx.showToast({ title: '人数至少 1 人', icon: 'none' });
    }
    if (formData.recruitDeadline && formData.recruitDeadline <= Date.now()) {
      return wx.showToast({ title: '招募截止时间必须晚于现在', icon: 'none' });
    }

    // 2) 确保有 openid：未登录时先做静默登录
    let userInfo = app.globalData.userInfo;
    if (!userInfo || !userInfo._openid) {
      wx.showLoading({ title: '登录中…', mask: true });
      userInfo = await app.loginSilently();
      wx.hideLoading();
    }
    if (!userInfo || !userInfo._openid) {
      return wx.showModal({
        title: '提示',
        content: '静默登录失败，请确认云函数 login 已部署后再试',
        showCancel: false
      });
    }

    // 3) 主动询问一次昵称头像（已存在则跳过，不阻塞）
    //    失败也不影响发布，云函数会用默认昵称
    const profile = await app.ensureUserProfile();
    userInfo = profile || userInfo;

    // 4) 提交云函数
    this.setData({ submitting: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        // 约定云函数入参：type=add, payload=帖子内容
        data: {
          type: 'add',
          payload: {
            sport: formData.sport,
            time: formData.time,
            location: formData.location.trim(),
            needCount: formData.needCount,
            scope: formData.scope,
            contact: formData.contact.trim(),
            remark: formData.remark.trim(),
            // 招募截止时间戳（毫秒）；0 = 不自动截止
            recruitDeadline: formData.recruitDeadline || 0,
            // 冗余存储昵称头像，方便列表展示免 join
            nickName: userInfo.nickName || '拾球记用户',
            avatarUrl: userInfo.avatarUrl || ''
          }
        }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' });
        // 关键：ball/list 是 tabBar 页面，redirectTo 会失败，必须用 switchTab
        setTimeout(() => {
          wx.switchTab({ url: '/pages/ball/list' });
        }, 800);
      } else {
        wx.showModal({
          title: '发布失败',
          content: (resp.result && resp.result.errMsg) || '请稍后重试',
          showCancel: false
        });
      }
    } catch (err) {
      this.setData({ submitting: false });
      console.error('[ball publish] cloud call failed 真实错误:', err);
      const realErr = (err && (err.errMsg || err.message)) || JSON.stringify(err);
      wx.showModal({
        title: '发布失败 - 真实错误',
        content: realErr + '\n\n排查：\n1. cloudfunctions/ballAdd 是否上传？\n2. ball_posts 集合是否创建？\n3. env ID 是否正确？',
        showCancel: false
      });
    }
  }
});
