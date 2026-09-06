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

    // 自定义时间 picker 弹层状态（scroll-view 列）
    timePickerCustomVisible: false,
    timeHourIndex: 0,
    timeMinuteIndex: 0,
    timeHourScrollTop: 0,
    timeMinuteScrollTop: 0,
    hourList: ['00','01','02','03','04','05','06','07','08','09','10','11',
               '12','13','14','15','16','17','18','19','20','21','22','23'],
    // 分钟：5 分钟一档，与默认时间「向上取整到 5 分钟」一致
    minuteList: ['00','05','10','15','20','25','30','35','40','45','50','55'],

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
    // 关键：先算 rpx → px 系数（scroll-view 的 scroll-top 是 px）
    try {
      const info = wx.getSystemInfoSync();
      if (info && info.windowWidth) {
        pickerPxPerRpx = info.windowWidth / 750;
      }
    } catch (e) {
      pickerPxPerRpx = 1;
    }

    // 默认选中第一个运动项目，给用户一个友好起点
    this.setData({
      'formData.sport': this.data.sportList[0].value
    });

    // 关键：构建日期列表（今年 ~ 今年 + 2 所有有效日期）
    // 重构后：单列 scroll-view，dateList 是 [{year, month, day}, ...] 的扁平数组
    this.setData({ dateList: this._buildDateList() });

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

  // 打开时间 picker：解析 timeTime → 时/分 index → 设初始 scrollTop
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
    const hourIndex = Math.max(0, this.data.hourList.indexOf(String(hour).padStart(2, '0')));
    const minuteIndex = Math.max(0, this.data.minuteList.indexOf(String(minute).padStart(2, '0')));
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
  // 关键重构：日期 picker 是单列 scroll-view，column = 'single'
  onPickerColumnScroll(e) {
    if (isPickerSnapping) return;
    const { picker, column } = e.currentTarget.dataset;
    const scrollTopPx = e.detail.scrollTop;
    const scrollTopRpx = scrollTopPx / pickerPxPerRpx;
    const index = Math.round(scrollTopRpx / PICKER_ITEM_HEIGHT);
    const maxIndex = this._getPickerColumnMaxIndex(picker, column);
    const clamped = Math.max(0, Math.min(maxIndex, index));

    if (picker === 'date') {
      // 单列日期：直接更新 dateIndex
      if (this.data.dateIndex !== clamped) {
        this.setData({ dateIndex: clamped });
      }
    } else if (picker === 'time') {
      // 时分两列：保持原逻辑
      const updateKey = `time${column[0].toUpperCase() + column.slice(1)}Index`;
      if (this.data[updateKey] !== clamped) {
        this.setData({ [updateKey]: clamped });
      }
    }

    // snap 校准：滚动停下后把 scrollTop 对齐到最近 item
    if (pickerSnapTimer) clearTimeout(pickerSnapTimer);
    pickerSnapTimer = setTimeout(() => {
      const targetPx = pickerRpx2px(clamped * PICKER_ITEM_HEIGHT);
      const currentScrollPx = picker === 'date' ? this.data.dateScrollTop : this.data[`time${column[0].toUpperCase() + column.slice(1)}ScrollTop`];
      if (Math.abs(scrollTopPx - targetPx) > 1) {
        isPickerSnapping = true;
        if (picker === 'date') {
          this.setData({ dateScrollTop: targetPx });
        } else {
          this.setData({ [`time${column[0].toUpperCase() + column.slice(1)}ScrollTop`]: targetPx });
        }
        setTimeout(() => { isPickerSnapping = false; }, 300);
      }
    }, 150);
  },

  // 各列最大下标（用于 scroll 计算时夹回合法范围）
  _getPickerColumnMaxIndex(picker, column) {
    if (picker === 'date') {
      // 单列日期：最大下标 = dateList.length - 1
      return this.data.dateList.length - 1;
    } else if (picker === 'time') {
      if (column === 'hour') return this.data.hourList.length - 1;
      if (column === 'minute') return this.data.minuteList.length - 1;
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

  // 确定时间：把 [时,分] 下标拼成 "HH:mm" 写回 timeTime
  onConfirmTimePicker() {
    const hour = this.data.hourList[this.data.timeHourIndex];
    const minute = this.data.minuteList[this.data.timeMinuteIndex];
    const timeTime = `${hour}:${minute}`;
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
    // 关键：有效截止时间 = 用户填的招募截止时间；不填则默认为约球时间
    const effectiveDeadline = formData.recruitDeadline
      || (formData.time ? new Date(formData.time.replace(' ', 'T') + ':00').getTime() : 0);
    if (effectiveDeadline && effectiveDeadline <= Date.now()) {
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
    try {
      const resp = await wx.cloud.callFunction({
        name: 'ballAdd',
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
            recruitDeadline: formData.recruitDeadline
              || (formData.time ? new Date(formData.time.replace(' ', 'T') + ':00').getTime() : 0),
            nickName: userInfo.nickName || '拾球记用户',
            avatarUrl: userInfo.avatarUrl || ''
          }
        }
      });
      this.setData({ submitting: false });
      if (resp.result && resp.result.success) {
        wx.showToast({ title: '发布成功', icon: 'success' });

        const postId = resp.result.data && resp.result.data._id;
        if (postId && formData.remindEnabled) {
          const { optInReminder } = require('../../utils/reminder.js');
          optInReminder({ postId: postId, recipientKind: 'creator' });
        }

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
