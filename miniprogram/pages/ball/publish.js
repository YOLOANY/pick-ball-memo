// pages/ball/publish.js
// 约球帖子发布页逻辑
// 职责：
//   1. 维护表单数据 formData
//   2. 提供项目 / 时间 / 人数 / 招募范围等交互
//   3. 时间选择：日期 + 时间都用自定义 scroll-view 滚轮弹层（点日期/时间格调起，字体 40rpx，PC 鼠标滚轮可用）
//   4. 日期和时间分开：改其中一个不会影响另一个
//   5. 默认时间 = 进入页面时「当前时间 + 3 小时」，向上取整到 5 分钟
//   6. 提交时进行基础校验，再调用 ballAdd 云函数写入云数据库 ball_posts 集合

const app = getApp();

// 工具：某年某月有多少天
// 关键：month 取 1-12；用 new Date(year, month, 0) 取得当月最后一天
function getDaysInMonth(year, month) {
  return new Date(year, month, 0).getDate();
}

// 工具：把分钟数向上取整到 5 的倍数
function ceilToFive(min) {
  return Math.ceil(min / 5) * 5;
}

// 工具：获取「当前时间 + 3 小时」，向上取整到 5 分钟
// 关键：返回新的 Date 实例，避免污染 Date.now()
function getDefaultDate() {
  const d = new Date();
  d.setHours(d.getHours() + 3);
  let mi = ceilToFive(d.getMinutes());
  if (mi >= 60) {
    d.setHours(d.getHours() + 1);
    mi = 0;
  }
  d.setMinutes(mi);
  d.setSeconds(0, 0);
  return d;
}

// 工具：把 Date 格式化为 "YYYY-MM-DD HH:mm"
function formatDateTime(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

// 工具：把 Date 格式化为 "YYYY-MM-DD"
function formatDateOnly(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

// 工具：把 Date 格式化为 "HH:mm"
function formatTimeOnly(d) {
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${mi}`;
}

// 时间：日期 + 时间统一用自定义 scroll-view 滚轮（PC 鼠标滚轮可用）
// 与之前 formData.time 格式完全一致

// picker 弹层：每个 item 的高度（rpx），必须和 WXSS .picker-wheel-item height 一致
const PICKER_ITEM_HEIGHT = 90;
// snap 防抖：避免快速滚动时频繁写 scrollTop
let pickerSnapTimer = null;
let isPickerSnapping = false;
// rpx → px 换算（scroll-view 的 scroll-top / detail.scrollTop 都是 px）
let pickerPxPerRpx = 1;
function pickerRpx2px(rpx) { return rpx * pickerPxPerRpx; }

Page({
  data: {
    // 表单数据：所有用户输入最终汇总到这里
    formData: {
      sport: '',            // 运动项目枚举：tennis / basketball / ...
      time: '',             // 约球时间（已格式化的字符串 YYYY-MM-DD HH:mm）
      location: '',         // 地点
      needCount: 2,         // 需要人数（不含发起人）
      scope: 'all',         // 招募范围：all / college / grade
      contact: '',          // 联系方式（选填）
      remark: '',           // 备注说明
      recruitDeadline: 0,        // 招募截止时间戳（毫秒）；0 = 不自动截止
      recruitDeadlineText: '',   // 招募截止时间显示文案
      remindEnabled: false        // 是否为自己开启「提前 2 小时提醒」
    },

    // 招募截止时间选择弹层：date + time picker 同屏可调
    deadlinePickerVisible: false,
    deadlineDate: '',            // YYYY-MM-DD
    deadlineTime: '',            // HH:MM
    deadlineDateStart: '',       // 今天
    deadlineDateEnd: '',         // 30 天后

    // ============ 时间选择：自定义 scroll-view 滚轮弹层（PC 鼠标滚轮可用） ============
    // 关键：picker-view 在 PC 上只滚页面不滚选择；改用 scroll-view + 中心高亮条
    // 关键：formData.time 始终 = "YYYY-MM-DD HH:mm"，与之前完全一致
    timeDate: '',                  // YYYY-MM-DD（日期行）
    timeTime: '',                  // HH:mm（时间行）
    timeDateStart: '',             // 今天
    timeDateEnd: '',               // 今天 + 730 天（约 2 年）
    // 错误提示
    timeError: '',                 // 整体校验错误（如"已在过去"）

    // 自定义日期 picker 弹层状态（单列 scroll-view，每行渲染完整日期 "2026年 9月 6日"）
    // 关键重构：三列独立 scroll-view → 单个 scroll-view，三段文字天然在同一垂直线
    datePickerVisible: false,
    dateIndex: 0,
    dateScrollTop: 0,
    dateList: [],                  // 动态生成：[{year, month, day}, ...] 今年~今年+2 所有有效日期

    // 自定义时间 picker 弹层状态（时 / 分 两列独立 scroll-view，PC 鼠标滚轮可用）
    timePickerCustomVisible: false,
    timeHourIndex: 0,
    timeMinuteIndex: 0,
    timeHourScrollTop: 0,
    timeMinuteScrollTop: 0,
    hourList: [],                 // 动态生成：['00', '01', ..., '23'] 共 24 项
    minuteList: [],               // 动态生成：['00', '01', ..., '59'] 共 60 项

    // 编辑模式：发布页复用做编辑入口，query 形如 ?id=xxx&mode=edit
    // 关键：仅创建者、status=open、joinedUsers 为空时才能进编辑模式
    editingId: '',                // 编辑模式下的 post id
    editingMode: false,           // 是否编辑模式（true 时 UI 切换为"编辑"文案）
    loading: false,               // 编辑模式下加载详情的 loading

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
  async onLoad(query) {
    // 关键：先算 rpx → px 系数（scroll-view 的 scroll-top 是 px）
    try {
      const info = wx.getSystemInfoSync();
      if (info && info.windowWidth) {
        pickerPxPerRpx = info.windowWidth / 750;
      }
    } catch (e) {
      pickerPxPerRpx = 1;
    }

    // 关键：构建日期 / 时间列表（无论新建还是编辑都需要）
    this.setData({
      dateList: this._buildDateList(),
      hourList: this._buildHourList(),
      minuteList: this._buildMinuteList()
    });

    // 关键：编辑模式 —— 形如 ?id=xxx&mode=edit
    // 跳过默认时间初始化，改为从云端拉详情后预填表单
    if (query && query.mode === 'edit' && query.id) {
      await this._loadForEdit(query.id);
      return;
    }

    // 默认选中第一个运动项目，给用户一个友好起点
    this.setData({
      'formData.sport': this.data.sportList[0].value
    });

    // 关键：默认时间 = 当前时间 + 3 小时，向上取整到 5 分钟
    const defaultDate = getDefaultDate();
    this._initTimePicker(defaultDate);

    // 初始化截止时间 picker 的可选日期范围：今天 ~ 30 天后
    const today = this._formatDate(new Date());
    const d30 = new Date();
    d30.setDate(d30.getDate() + 30);
    const maxDate = this._formatDate(d30);
    let initDate = today;
    let initTime = '12:00';
    if (this.data.formData.recruitDeadline) {
      const d = new Date(this.data.formData.recruitDeadline);
      if (Number.isFinite(d.getTime()) && d.getTime() > Date.now()) {
        initDate = this._formatDate(d);
        initTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    }
    this.setData({
      deadlineDateStart: today,
      deadlineDateEnd: maxDate,
      deadlineDate: initDate,
      deadlineTime: initTime
    });
  },

  // 编辑模式初始化：拉 post 详情 → 映射到 formData → 设置 UI 状态
  // 关键：
  //   1) 拉到的 post 必须满足可编辑条件（创建者、status=open、joinedUsers 空）—— 否则 toast 提示并返回
  //   2) 字段映射：DB 字段 → formData；time 拆为 timeDate + timeTime
  //   3) recruitDeadline 同时写回 deadlineDate / deadlineTime，让弹层显示正确
  //   4) 跳过 _initTimePicker —— 默认时间公式不适用
  async _loadForEdit(postId) {
    this.setData({ loading: true });
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
        data: { type: 'detail', id: postId }
      });
      this.setData({ loading: false });
      if (!resp.result || !resp.result.success) {
        const errMap = {
          NOT_FOUND: '帖子不存在',
          NO_AUTH: '请先登录',
          FORBIDDEN: '没有权限查看此帖'
        };
        wx.showToast({
          title: errMap[resp.result && resp.result.errCode] || (resp.result && resp.result.errMsg) || '加载失败',
          icon: 'none'
        });
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }
      const post = resp.result.data;
      if (!post) {
        wx.showToast({ title: '帖子不存在', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 800);
        return;
      }

      // 解析 post.time = "YYYY-MM-DD HH:mm" → timeDate + timeTime
      const timeStr = post.time || '';
      let timeDate = '';
      let timeTime = '';
      if (timeStr) {
        const parts = timeStr.split(' ');
        if (parts.length === 2) {
          timeDate = parts[0]; // YYYY-MM-DD
          timeTime = parts[1].slice(0, 5); // HH:mm
        }
      }
      if (!timeDate) {
        // 兜底：用 defaultDate
        const d = getDefaultDate();
        timeDate = formatDateOnly(d);
        timeTime = formatTimeOnly(d);
      }

      // 截止时间拆分
      const today = this._formatDate(new Date());
      const d30 = new Date();
      d30.setDate(d30.getDate() + 30);
      const maxDate = this._formatDate(d30);
      let deadlineDate = today;
      let deadlineTime = '12:00';
      if (post.recruitDeadline && post.recruitDeadline > Date.now()) {
        deadlineDate = this._formatDate(new Date(post.recruitDeadline));
        const dd = new Date(post.recruitDeadline);
        deadlineTime = `${String(dd.getHours()).padStart(2, '0')}:${String(dd.getMinutes()).padStart(2, '0')}`;
      }

      // 计算日期 picker 可选范围：今天 + 730 天
      const todayStr = formatDateOnly(new Date());
      const dFar = new Date();
      dFar.setDate(dFar.getDate() + 730);
      const maxDateStr = formatDateOnly(dFar);

      this.setData({
        editingId: postId,
        editingMode: true,
        'formData.sport': post.sport || '',
        'formData.time': timeStr,
        'formData.location': post.location || '',
        'formData.needCount': post.needCount || 2,
        'formData.scope': post.scope || 'all',
        'formData.contact': post.contact || '',
        'formData.remark': post.remark || '',
        'formData.recruitDeadline': post.recruitDeadline || 0,
        'formData.recruitDeadlineText': post.recruitDeadline
          ? `${deadlineDate} ${deadlineTime}`
          : '',
        timeDate,
        timeTime,
        timeDateStart: todayStr,
        timeDateEnd: maxDateStr,
        deadlineDateStart: today,
        deadlineDateEnd: maxDate,
        deadlineDate,
        deadlineTime
      });
      // 关键：编辑模式改导航栏标题
      wx.setNavigationBarTitle({ title: '编辑约球' });
    } catch (e) {
      this.setData({ loading: false });
      console.error('[ball publish] _loadForEdit error', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
    }
  },

  // 初始化时间选择器（日期 + 时间都用原生 picker）
  // 关键：根据传入的 Date d 同时更新 formData.time / timeDate / timeTime
  //      调用前应保证 d 在未来
  _initTimePicker(d) {
    const dateStr = formatDateOnly(d);
    const todayStr = formatDateOnly(new Date());
    // 关键：约球时间 picker 的可选终点设为「今天 + 2 年」
    // 之前的 30 天太短，提前规划的 2027 年滚不进去
    // （招募截止时间 deadline 那个 picker 仍然保持 30 天，不受影响）
    const dFar = new Date();
    dFar.setDate(dFar.getDate() + 730);
    const maxDateStr = formatDateOnly(dFar);

    const timeStr = formatTimeOnly(d);

    this.setData({
      'formData.time': formatDateTime(d),
      timeDateStart: todayStr,
      timeDateEnd: maxDateStr,
      timeDate: dateStr,
      timeTime: timeStr,
      timeError: ''
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

  // ============ 时间选择：自定义 scroll-view 滚轮弹层（PC 鼠标滚轮可用） ============
  // 关键：picker-view 在 PC 上只滚页面不滚选择；改用 scroll-view + 中心高亮条
  // 关键：日期 3 列（年/月/日）、时间 2 列（时/分），每列独立 scrollTop + index
  // 关键：日期 / 时间 是分开的两块；改其中一块不会影响另一块

  // 打开日期 picker：解析 timeDate → 在 dateList 中找匹配下标 → 设初始 scrollTop 让选中项居中
  onOpenDatePicker() {
    let year, month, day;
    if (this.data.timeDate) {
      const parts = this.data.timeDate.split('-');
      year = parseInt(parts[0], 10);
      month = parseInt(parts[1], 10);
      day = parseInt(parts[2], 10);
    } else {
      const now = new Date();
      year = now.getFullYear();
      month = now.getMonth() + 1;
      day = now.getDate();
    }
    // 关键：在 dateList 中找匹配项
    const foundIndex = this.data.dateList.findIndex(
      item => item.year === year && item.month === month && item.day === day
    );
    const finalIndex = foundIndex >= 0 ? foundIndex : 0;
    this.setData({
      datePickerVisible: true,
      dateIndex: finalIndex,
      dateScrollTop: pickerRpx2px(finalIndex * PICKER_ITEM_HEIGHT)
    });
  },

  onCloseDatePicker() {
    this.setData({ datePickerVisible: false });
  },

  // 打开时间 picker：解析 timeTime → 时分下标 → 设初始 scrollTop 让选中项居中
  onOpenTimePicker() {
    let hour, minute;
    if (this.data.timeTime) {
      const parts = this.data.timeTime.split(':');
      hour = parseInt(parts[0], 10);
      minute = parseInt(parts[1], 10);
    } else {
      hour = new Date().getHours();
      minute = 0;
    }
    // 关键：把分钟向上取整到 5 分钟档（与默认时间规则一致）
    const roundedMinute = Math.ceil(minute / 5) * 5;
    let targetHour = hour;
    let targetMinute = roundedMinute;
    if (roundedMinute >= 60) {
      targetHour = (hour + 1) % 24;
      targetMinute = 0;
    }
    const hourIndex = Math.max(0, Math.min(this.data.hourList.length - 1, targetHour));
    const minuteIndex = Math.max(0, Math.min(this.data.minuteList.length - 1, targetMinute));
    this.setData({
      timePickerCustomVisible: true,
      timeHourIndex: hourIndex,
      timeMinuteIndex: minuteIndex,
      timeHourScrollTop: pickerRpx2px(hourIndex * PICKER_ITEM_HEIGHT),
      timeMinuteScrollTop: pickerRpx2px(minuteIndex * PICKER_ITEM_HEIGHT)
    });
  },

  onCloseTimePicker() {
    this.setData({ timePickerCustomVisible: false });
  },

  // 统一列滚动 handler（PC 鼠标滚轮 / 移动端触摸都会触发）
  // 关键：bindscroll 给的 scrollTop 是 px，要先转回 rpx 再算 index
  // 关键：snap 防抖：滚动停下后把 scrollTop 校准到最近 item 的整数倍
  // 关键：日期 picker 为单列（column = 'single'）；时间 picker 为时 / 分两列（column = 'hour' / 'minute'）
  onPickerColumnScroll(e) {
    if (isPickerSnapping) return;
    const { picker, column } = e.currentTarget.dataset;
    const scrollTopPx = e.detail.scrollTop;
    const scrollTopRpx = scrollTopPx / pickerPxPerRpx;
    const index = Math.round(scrollTopRpx / PICKER_ITEM_HEIGHT);
    const maxIndex = this._getPickerColumnMaxIndex(picker, column);
    const clamped = Math.max(0, Math.min(maxIndex, index));

    let scrollKey = '';
    if (picker === 'date' && column === 'single') {
      // 单列日期
      if (this.data.dateIndex !== clamped) {
        this.setData({ dateIndex: clamped });
      }
      scrollKey = 'date';
    } else if (picker === 'time' && column === 'hour') {
      if (this.data.timeHourIndex !== clamped) {
        this.setData({ timeHourIndex: clamped });
      }
      scrollKey = 'timeHour';
    } else if (picker === 'time' && column === 'minute') {
      if (this.data.timeMinuteIndex !== clamped) {
        this.setData({ timeMinuteIndex: clamped });
      }
      scrollKey = 'timeMinute';
    }

    if (!scrollKey) return;

    // snap 校准：滚动停下后把 scrollTop 对齐到最近 item
    if (pickerSnapTimer) clearTimeout(pickerSnapTimer);
    pickerSnapTimer = setTimeout(() => {
      const targetPx = pickerRpx2px(clamped * PICKER_ITEM_HEIGHT);
      if (Math.abs(scrollTopPx - targetPx) > 1) {
        isPickerSnapping = true;
        const updateKey = `${scrollKey}ScrollTop`;
        this.setData({ [updateKey]: targetPx });
        setTimeout(() => { isPickerSnapping = false; }, 300);
      }
    }, 150);
  },

  // 各列最大下标（用于 scroll 计算时夹回合法范围）
  _getPickerColumnMaxIndex(picker, column) {
    if (picker === 'date') {
      // 单列日期：最大下标 = dateList.length - 1
      return this.data.dateList.length - 1;
    } else if (picker === 'time' && column === 'hour') {
      return this.data.hourList.length - 1;
    } else if (picker === 'time' && column === 'minute') {
      return this.data.minuteList.length - 1;
    }
    return 0;
  },

  // 确定日期：从 dateList[dateIndex] 取 {year, month, day} 拼成 "YYYY-MM-DD" 写回 timeDate
  onConfirmDatePicker() {
    const item = this.data.dateList[this.data.dateIndex] || this.data.dateList[0];
    const month = String(item.month).padStart(2, '0');
    const day = String(item.day).padStart(2, '0');
    const timeDate = `${item.year}-${month}-${day}`;
    this.setData({ timeDate, datePickerVisible: false });
    this._syncTimeToFormData();
  },

  // 确定时间：拼接 hourList[timeHourIndex] + minuteList[timeMinuteIndex] → "HH:mm"
  onConfirmTimePicker() {
    const hh = this.data.hourList[this.data.timeHourIndex] || this.data.hourList[0];
    const mm = this.data.minuteList[this.data.timeMinuteIndex] || this.data.minuteList[0];
    const timeTime = `${hh}:${mm}`;
    this.setData({ timeTime, timePickerCustomVisible: false });
    this._syncTimeToFormData();
  },

  // 同步 formData.time = "YYYY-MM-DD HH:mm" + 整体过去检查
  // 关键：日期 + 时间 是两个独立数据源，组合时再校验"合起来是否在过去"
  _syncTimeToFormData() {
    const date = this.data.timeDate;
    const time = this.data.timeTime;
    if (!date || !time) {
      this.setData({ 'formData.time': '', timeError: '' });
      return;
    }
    const timeStr = `${date} ${time}`;
    const ts = new Date(timeStr.replace(' ', 'T') + ':00').getTime();
    let overallErr = '';
    if (!Number.isFinite(ts) || ts <= Date.now()) {
      overallErr = '日期 + 时间已在过去，请调大';
    }
    this.setData({
      'formData.time': timeStr,
      timeError: overallErr
    });
  },

  // ============ 招募截止时间：弹层方式（date + time 同屏可调） ============
  onOpenDeadlinePicker() {
    let initDate = this._formatDate(new Date());
    let initTime = '12:00';
    if (this.data.formData.recruitDeadline) {
      const d = new Date(this.data.formData.recruitDeadline);
      if (Number.isFinite(d.getTime()) && d.getTime() > Date.now()) {
        initDate = this._formatDate(d);
        initTime = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      }
    }
    this.setData({
      deadlinePickerVisible: true,
      deadlineDate: initDate,
      deadlineTime: initTime
    });
  },

  onCloseDeadlinePicker() {
    this.setData({ deadlinePickerVisible: false });
  },

  onDeadlineDateChange(e) {
    this.setData({ deadlineDate: e.detail.value });
  },

  onDeadlineTimeChange(e) {
    this.setData({ deadlineTime: e.detail.value });
  },

  // 关键：点确认时做一次完整校验，避免写入过去时间
  onConfirmDeadline() {
    const { deadlineDate, deadlineTime } = this.data;
    if (!deadlineDate || !deadlineTime) {
      return wx.showToast({ title: '请选择日期和时间', icon: 'none' });
    }
    const ts = new Date(`${deadlineDate} ${deadlineTime}:00`).getTime();
    if (!Number.isFinite(ts)) {
      return wx.showToast({ title: '时间格式错误', icon: 'none' });
    }
    if (ts <= Date.now()) {
      return wx.showToast({ title: '截止时间必须在未来', icon: 'none' });
    }
    if (ts - Date.now() > 30 * 24 * 3600 * 1000) {
      return wx.showToast({ title: '不能超过 30 天', icon: 'none' });
    }
    this.setData({
      'formData.recruitDeadline': ts,
      'formData.recruitDeadlineText': `${deadlineDate} ${deadlineTime}`,
      deadlinePickerVisible: false
    });
  },

  onClearDeadline() {
    this.setData({
      'formData.recruitDeadline': 0,
      'formData.recruitDeadlineText': ''
    });
  },

  // 提醒开关
  onToggleRemind(e) {
    this.setData({ 'formData.remindEnabled': !!e.detail.value });
  },

  // 将 Date 格式化为 YYYY-MM-DD
  _formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },

  // 工具：构建日期列表（今年 ~ 今年+2 所有有效日期，过滤掉不存在的日期如 2月30日）
  // 关键：单列 scroll-view 用的扁平数组，每个元素是 {year, month, day}
  _buildDateList() {
    const curYear = new Date().getFullYear();
    const list = [];
    for (let y = curYear; y <= curYear + 2; y++) {
      for (let m = 1; m <= 12; m++) {
        const dayCount = new Date(y, m, 0).getDate();
        for (let d = 1; d <= dayCount; d++) {
          list.push({ year: y, month: m, day: d });
        }
      }
    }
    return list;
  },

  // 工具：构建小时列表（"00" ~ "23"，24 项）
  _buildHourList() {
    const list = [];
    for (let h = 0; h < 24; h++) {
      list.push(String(h).padStart(2, '0'));
    }
    return list;
  },

  // 工具：构建分钟列表（"00" ~ "59"，60 项）
  _buildMinuteList() {
    const list = [];
    for (let m = 0; m < 60; m++) {
      list.push(String(m).padStart(2, '0'));
    }
    return list;
  },

  // ============ 提交 ============
  async onSubmit() {
    if (this.data.submitting) return;

    const { formData } = this.data;

    console.log('[publish] 提交时表单数据:', JSON.stringify(formData, null, 2));

    // 1) 基础校验
    if (!formData.sport) {
      return wx.showToast({ title: '请选择运动项目', icon: 'none' });
    }
    if (!formData.time) {
      return wx.showToast({ title: '请选择约球时间', icon: 'none' });
    }
    // 关键：兜底再校验一次「不能在过去」
    const submitTs = new Date(formData.time.replace(' ', 'T') + ':00').getTime();
    if (!Number.isFinite(submitTs) || submitTs <= Date.now()) {
      return wx.showToast({ title: '约球时间必须晚于现在', icon: 'none' });
    }
    if (!formData.location || !formData.location.trim()) {
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
    // 关键：有效截止时间 = 用户填的招募截止时间；不填则默认为现在+3小时（与约球时间默认值一致）
    const effectiveDeadline = formData.recruitDeadline || getDefaultDate().getTime();
    if (effectiveDeadline <= Date.now()) {
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
    const profile = await app.ensureUserProfile();
    userInfo = profile || userInfo;

    // 4) 提交云函数
    this.setData({ submitting: true });
    const isEdit = this.data.editingMode && this.data.editingId;
    try {
      const payload = {
        sport: formData.sport,
        time: formData.time,
        location: formData.location.trim(),
        needCount: formData.needCount,
        scope: formData.scope,
        contact: formData.contact.trim(),
        remark: formData.remark.trim(),
        recruitDeadline: formData.recruitDeadline || getDefaultDate().getTime()
      };
      const callData = isEdit
        ? { type: 'update', id: this.data.editingId, payload }
        : {
            type: 'add',
            payload: Object.assign({}, payload, {
              nickName: userInfo.nickName || '拾球记用户',
              avatarUrl: userInfo.avatarUrl || ''
            })
          };
      const resp = await wx.cloud.callFunction({ name: 'ballAdd', data: callData });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: isEdit ? '保存成功' : '发布成功', icon: 'success' });

        if (!isEdit) {
          // 仅新建场景需要开启提醒；编辑场景下云函数已 cancelRemindersByPost，用户需手动重开
          const postId = resp.result.data && resp.result.data._id;
          if (postId && formData.remindEnabled) {
            const { optInReminder } = require('../../utils/reminder.js');
            optInReminder({ postId: postId, recipientKind: 'creator' });
          }
        }

        // 关键：编辑完 navigateBack 回详情页（详情页 onShow 会自动刷新）；
        //       新发布 switchTab 回约球广场
        setTimeout(() => {
          if (isEdit) {
            wx.navigateBack({ delta: 1 });
          } else {
            wx.switchTab({ url: '/pages/ball/list' });
          }
        }, 800);
      } else {
        // 关键：编辑模式下的 errCode 翻译更细
        if (isEdit) {
          const errMap = {
            FORBIDDEN: '只有发起人可以编辑',
            NOT_EDITABLE: '当前状态不允许编辑',
            HAS_JOINERS: '已有人入队，不能编辑',
            NOT_FOUND: '帖子不存在',
            INVALID_PARAM: (resp.result && resp.result.errMsg) || '字段格式不正确'
          };
          const code = (resp.result && resp.result.errCode) || '';
          wx.showToast({
            title: errMap[code] || (resp.result && resp.result.errMsg) || '保存失败',
            icon: 'none'
          });
        } else {
          wx.showModal({
            title: '发布失败',
            content: (resp.result && resp.result.errMsg) || '请稍后重试',
            showCancel: false
          });
        }
      }
    } catch (err) {
      this.setData({ submitting: false });
      console.error('[ball publish] cloud call failed 真实错误:', err);
      const realErr = (err && (err.errMsg || err.message)) || JSON.stringify(err);
      wx.showModal({
        title: isEdit ? '保存失败 - 真实错误' : '发布失败 - 真实错误',
        content: realErr + '\n\n排查：\n1. cloudfunctions/ballAdd 是否上传？\n2. ball_posts 集合是否创建？\n3. env ID 是否正确？',
        showCancel: false
      });
    }
  }
});
