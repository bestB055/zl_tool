const shifts = [
    { id: 'morning', name: '早' },
    { id: 'normal', name: '常' },
    { id: 'night', name: '晚' },
];
const schedulePolicy = {
    weekdayMinimum: 7,
    weekendMinimum: 6,
    specialWeekdays: [3],
    specialMinimum: 8,
    minimumMorning: 3,
    minimumNight: 3,
    hoursPerDay: 8,
    maximumExtraDays: 2,
    maximumConsecutiveDays: 6,
    maximumPreferredPureRestDays: 2,
    internalPureRestPenalty: 12,
    boundaryPureRestPenalty: 10,
    compactWorkSegmentReward: 16,
    isolatedWorkDayPenalty: 24,
    sixDayWorkSegmentPenalty: 32,
    candidatePureRestBenefitCap: 32,
    dailyShiftImbalancePenalty: 16,
};
const DEPLOYMENT_CONFIG = window.DAIBAN_HOME_CONFIG || {};
const DEEPSEEK_PROXY_API_URL = String(DEPLOYMENT_CONFIG.DEEPSEEK_PROXY_API_URL || '').trim();
const AI_SOLUTION_COUNT = 3;
const SCHEDULE_RULES_URL = '排班提示.txt?v=20260801-7';
const MAX_ARCHIVE_FILE_SIZE = 20 * 1024 * 1024;
const MAX_ARCHIVE_PEOPLE = 300;
const MAX_ARCHIVE_DATES = 62;

function createDefaultStaffing() {
    return {
        baseTotal: schedulePolicy.weekdayMinimum,
        baseMorning: schedulePolicy.minimumMorning,
        baseNight: schedulePolicy.minimumNight,
        strategies: [
            {
                id: 'preset-special-weekdays',
                name: '周三',
                type: 'weekday',
                dates: [],
                weekdays: [3],
                total: schedulePolicy.specialMinimum,
                morning: null,
                night: null,
                enabled: true,
            },
            {
                id: 'preset-weekend',
                name: '周末',
                type: 'weekday',
                dates: [],
                weekdays: [0, 6],
                total: schedulePolicy.weekendMinimum,
                morning: null,
                night: null,
                enabled: true,
            },
        ],
    };
}

const state = {
    viewMode: 'shift',
    selectedPersonId: 'p1',
    openPersonId: '',
    preferenceShifts: {},
    preferenceModes: {},
    shiftPreferences: {},
    forcedShiftChoices: {},
    forcedShiftEnabled: {},
    staffing: createDefaultStaffing(),
    people: [
        { id: 'p1', name: '迪加' },
        { id: 'p2', name: '爱林' },
        { id: 'p3', name: '凡东' },
        { id: 'p4', name: '秦成' },
        { id: 'p5', name: '治政' },
        { id: 'p6', name: '思梦' },
        { id: 'p7', name: '少聪' },
        { id: 'p8', name: '李洵' },
        { id: 'p9', name: '箫然' },
        { id: 'p10', name: '明月' },
        { id: 'p11', name: '雪莹' },
        { id: 'p12', name: '廖沙' },
        { id: 'p13', name: '婉凝' },
    ],
    rules: {},
    assignments: {},
    locked: {},
    lockOrigins: {},
    solutions: [],
    activeSolutionIndex: -1,
    diagnostics: {
        lastSolve: null,
    },
};

const calendarWrap = document.getElementById('calendarWrap');
const peopleList = document.getElementById('peopleList');
const solutionList = document.getElementById('solutionList');
const rangeText = document.getElementById('rangeText');
const calendarTitle = document.getElementById('calendarTitle');
const toast = document.getElementById('toast');
const archiveFileInput = document.getElementById('archiveFileInput');
const importArchiveBtn = document.getElementById('importArchiveBtn');
const solveBtn = document.getElementById('solveBtn');
const aiSolveBtn = document.getElementById('aiSolveBtn');
const aiSolveStatus = document.getElementById('aiSolveStatus');
const scheduleAiLoginLink = document.getElementById('scheduleAiLoginLink');
const baseTotalInput = document.getElementById('baseTotalInput');
const baseMorningInput = document.getElementById('baseMorningInput');
const baseNightInput = document.getElementById('baseNightInput');
const strategyTypeSelect = document.getElementById('strategyTypeSelect');
const strategyTotalInput = document.getElementById('strategyTotalInput');
const strategyMorningInput = document.getElementById('strategyMorningInput');
const strategyNightInput = document.getElementById('strategyNightInput');
const strategyTargetPicker = document.getElementById('strategyTargetPicker');
const cancelStrategyEditBtn = document.getElementById('cancelStrategyEditBtn');
const strategyList = document.getElementById('strategyList');
const strategyPreviewDialog = document.getElementById('strategyPreviewDialog');
const strategyPreview = document.getElementById('strategyPreview');
let toastTimer = null;
let archiveExtensions = {};
let scheduleRewardRules = '';
let editingStrategyId = '';
let strategyDraftDates = new Set();
let strategyDraftWeekdays = new Set();
let aiAbortController = null;
let localSolveRunning = false;
let highlightedSchedulePersonId = '';
let frozenScheduleHeader = null;
let frozenHeaderFrame = 0;

function getCycleDates() {
    const today = new Date();
    let startYear = today.getFullYear();
    let startMonth = today.getMonth();
    if (today.getDate() > 15) {
        startMonth += 1;
    }
    const start = new Date(startYear, startMonth, 16);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 15);
    const dates = [];
    for (const d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        dates.push({
            key: formatDateKey(d),
            label: `${d.getMonth() + 1}/${d.getDate()}`,
            full: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`,
            dayIndex: d.getDay(),
            weekday: ['日', '一', '二', '三', '四', '五', '六'][d.getDay()],
        });
    }
    return dates;
}

let dates = getCycleDates();
function formatDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getRequiredAttendanceDays() {
    return dates.filter((date) => date.dayIndex >= 1 && date.dayIndex <= 5).length;
}

function getRequiredAttendanceHours() {
    return getRequiredAttendanceDays() * schedulePolicy.hoursPerDay;
}

function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 2200);
}

function sanitizeText(value) {
    return String(value ?? '').replace(/[\u200B\u200C\u200D\uFEFF\u2060\u180E]/g, '');
}

function escapeHtml(value) {
    return sanitizeText(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function setAiSolveStatus(message = '', isError = false) {
    aiSolveStatus.textContent = message;
    aiSolveStatus.classList.toggle('error', isError);
}

function configureAiServiceLogin() {
    if (!scheduleAiLoginLink || !DEEPSEEK_PROXY_API_URL) return;
    try {
        const url = new URL(DEEPSEEK_PROXY_API_URL);
        url.pathname = '/auth-check';
        url.search = '';
        url.hash = '';
        scheduleAiLoginLink.href = url.toString();
        scheduleAiLoginLink.hidden = false;
    } catch {
        scheduleAiLoginLink.hidden = true;
    }
}

async function loadScheduleRewardRules(signal) {
    if (scheduleRewardRules) {
        return scheduleRewardRules;
    }
    const response = await fetch(SCHEDULE_RULES_URL, { cache: 'no-store', signal });
    if (!response.ok) {
        throw new Error(`奖励规则加载失败：HTTP ${response.status}`);
    }
    scheduleRewardRules = sanitizeText(await response.text()).trim();
    if (!scheduleRewardRules) {
        throw new Error('奖励规则文件为空');
    }
    return scheduleRewardRules;
}

function findJsonSegments(content) {
    const segments = [];
    let start = -1;
    let opening = '';
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < content.length; index += 1) {
        const character = content[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === '\\') {
                escaped = true;
            } else if (character === '"') {
                inString = false;
            }
            continue;
        }
        if (character === '"') {
            inString = true;
            continue;
        }
        if (character === '{' || character === '[') {
            if (!depth) {
                start = index;
                opening = character;
            }
            depth += 1;
        } else if (character === '}' || character === ']') {
            if (!depth) continue;
            const expected = opening === '{' ? '}' : ']';
            depth -= 1;
            if (!depth && character === expected && start >= 0) {
                segments.push(content.slice(start, index + 1));
                start = -1;
                opening = '';
            }
        }
    }
    return segments;
}

function repairJsonText(content) {
    return content
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\uFF1A]/g, ':')
        .replace(/[\uFF0C]/g, ',')
        .replace(/,\s*([}\]])/g, '$1');
}

function normalizeAiJsonResult(value) {
    let result = value;
    for (let depth = 0; depth < 3; depth += 1) {
        if (typeof result === 'string') {
            result = extractJson(result, 'AI 排班');
            continue;
        }
        if (result && typeof result === 'object' && !Array.isArray(result)) {
            if (Array.isArray(result.solutions)) {
                return {
                    ...result,
                    solutions: result.solutions.map(normalizeAiSolution),
                };
            }
            if (result.solutions && typeof result.solutions === 'object') {
                return { ...result, solutions: [normalizeAiSolution(result.solutions)] };
            }
            if (result.assignments || result.d || result.days) {
                return { solutions: [normalizeAiSolution(result)] };
            }
            if (result.schedule?.assignments) {
                return {
                    solutions: [{
                        ...result,
                        assignments: result.schedule.assignments,
                    }],
                };
            }
            const nested = result.data
                ?? result.result
                ?? result.output
                ?? result.candidates
                ?? result.solution;
            if (nested !== undefined) {
                result = nested;
                continue;
            }
        }
        break;
    }
    if (Array.isArray(result)) {
        return { solutions: result.map(normalizeAiSolution) };
    }
    throw new Error('AI 排班返回的 JSON 缺少 solutions 或 assignments');
}

function normalizeAiSolution(solution) {
    if (!solution || typeof solution !== 'object') {
        return solution;
    }
    const compactDays = solution.d ?? solution.days;
    return {
        ...solution,
        name: solution.name ?? solution.n ?? '',
        summary: solution.summary ?? solution.s ?? '',
        assignments: solution.assignments
            ?? (Array.isArray(compactDays) ? decodeCompactAssignments(compactDays) : undefined),
    };
}

function encodeCompactAssignments(assignments) {
    return dates.map((date) => [
        [...(assignments?.[date.key]?.morning || [])],
        [...(assignments?.[date.key]?.normal || [])],
        [...(assignments?.[date.key]?.night || [])],
    ]);
}

function decodeCompactAssignments(compactDays) {
    return Object.fromEntries(dates.map((date, index) => {
        const day = Array.isArray(compactDays[index]) ? compactDays[index] : [];
        return [date.key, {
            morning: Array.isArray(day[0]) ? day[0] : [],
            normal: Array.isArray(day[1]) ? day[1] : [],
            night: Array.isArray(day[2]) ? day[2] : [],
        }];
    }));
}

function extractJson(content, stage = 'DeepSeek') {
    if (content && typeof content === 'object') {
        return content;
    }
    const cleaned = sanitizeText(content)
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/i, '')
        .trim();
    const candidates = [cleaned, ...findJsonSegments(cleaned)];
    const attempted = new Set();

    for (const candidate of candidates) {
        for (const text of [candidate, repairJsonText(candidate)]) {
            if (!text || attempted.has(text)) continue;
            attempted.add(text);
            try {
                return JSON.parse(text);
            } catch {
                // Try the next complete JSON segment or conservative repair.
            }
        }
    }
    throw new Error(`${stage}返回的 JSON 无法解析，请重试`);
}

async function callDeepSeekJson(input, signal) {
    if (!DEEPSEEK_PROXY_API_URL) {
        throw new Error('未配置 DeepSeek AI 服务代理地址');
    }

    let response;
    try {
        response = await fetch(DEEPSEEK_PROXY_API_URL, {
            method: 'POST',
            signal,
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                operation: 'schedule-generation',
                input,
            }),
        });
    } catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) {
            throw new DOMException('AI 排班已中断', 'AbortError');
        }
        throw new Error('AI 排班网络请求失败，请先登录 AI 服务');
    }

    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error('AI 排班未获得授权，请先登录 AI 服务');
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
        throw new Error('AI 排班未获得授权，请先登录 AI 服务');
    }
    if (!response.ok) {
        throw new Error(`AI 排班失败：${payload.message || payload.error || `HTTP ${response.status}`}`);
    }
    return normalizeAiJsonResult(payload.result);
}

function getRule(personId, dateKey) {
    state.rules[personId] ||= {};
    state.rules[personId][dateKey] ||= {
        allow: new Set(),
        block: new Set(),
        vacation: false,
    };
    return state.rules[personId][dateKey];
}

function getPersonWorkloadTargets(personId) {
    const paidLeaveDays = dates.filter((date) => state.rules[personId]?.[date.key]?.vacation).length;
    const targetAttendanceDays = getRequiredAttendanceDays();
    const targetWorkDays = Math.max(0, targetAttendanceDays - paidLeaveDays);
    const maximumWorkDays = Math.min(
        dates.length - paidLeaveDays,
        targetWorkDays + schedulePolicy.maximumExtraDays,
    );
    return {
        paidLeaveDays,
        targetAttendanceDays,
        maximumAttendanceDays: targetAttendanceDays + schedulePolicy.maximumExtraDays,
        targetWorkDays,
        preferredWorkDays: targetWorkDays,
        maximumWorkDays,
    };
}

function getAssignment(dateKey, shiftId) {
    state.assignments[dateKey] ||= {};
    state.assignments[dateKey][shiftId] ||= [];
    return state.assignments[dateKey][shiftId];
}

function personName(personId) {
    return state.people.find((person) => person.id === personId)?.name || '未知人员';
}

function assignmentKey(dateKey, shiftId, personId) {
    return `${dateKey}|${shiftId}|${personId}`;
}

function hasPreferenceRule(personId, dateKey) {
    const rule = getRule(personId, dateKey);
    return rule.vacation || rule.allow.size > 0 || rule.block.size > 0;
}

function isAllDayAvailableRule(personId, dateKey) {
    const rule = getRule(personId, dateKey);
    return !rule.vacation
        && rule.allow.size === 1
        && rule.allow.has('all')
        && rule.block.size === 0;
}

function getManualEditBlockReason(personId, dateKey, requestedShiftId = '') {
    const forcedShift = getForcedShift(personId);
    if (requestedShiftId && forcedShift && requestedShiftId !== forcedShift) {
        return `该人员已强制${getShiftName(forcedShift)}班`;
    }
    const lockedShift = shifts.find((shift) =>
        hasLockedAssignment(personId, dateKey, shift.id)
    );
    if (lockedShift) {
        return '该日期已有固定班次，请先点击排班按钮取消固定或删除';
    }
    if (hasPreferenceRule(personId, dateKey) && !isAllDayAvailableRule(personId, dateKey)) {
        return '该日期已在人员固定班次中设置，请先回到人员卡片修改';
    }
    return '';
}

function normalizeStaffingNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0
        ? Math.min(number, MAX_ARCHIVE_PEOPLE)
        : fallback;
}

function parseOptionalStaffingNumber(value) {
    if (String(value).trim() === '') {
        return null;
    }
    const number = normalizeStaffingNumber(value, -1);
    if (number < 0) {
        throw new Error('人数必须是非负整数');
    }
    return number;
}

function invalidateSolutionsForStaffingChange() {
    state.solutions = [];
    state.activeSolutionIndex = -1;
    state.diagnostics.lastSolve = null;
    setAiSolveStatus('');
    renderRange();
    renderCalendar();
    renderSolutions();
}

function strategyMatchesDate(strategy, date) {
    if (!strategy.enabled) {
        return false;
    }
    return strategy.type === 'weekday'
        ? strategy.weekdays.includes(date.dayIndex)
        : strategy.dates.includes(date.key);
}

function applyStaffingStrategy(config, strategy) {
    ['total', 'morning', 'night'].forEach((field) => {
        if (strategy[field] !== null && strategy[field] !== undefined) {
            config[field] = strategy[field];
        }
    });
    config.appliedStrategyIds.push(strategy.id);
    return config;
}

function getStrategyTargetText(strategy) {
    if (strategy.type === 'weekday') {
        const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
        return strategy.weekdays.map((dayIndex) => weekdayNames[dayIndex]).join('、');
    }
    return strategy.dates.join('、');
}

function getDateConfig(dateKey) {
    const date = dates.find((item) => item.key === dateKey);
    const config = {
        total: state.staffing.baseTotal,
        morning: state.staffing.baseMorning,
        night: state.staffing.baseNight,
        appliedStrategyIds: [],
    };
    state.staffing.strategies
        .filter((strategy) => strategy.type === 'weekday' && strategyMatchesDate(strategy, date))
        .forEach((strategy) => applyStaffingStrategy(config, strategy));
    state.staffing.strategies
        .filter((strategy) => strategy.type === 'dates' && strategyMatchesDate(strategy, date))
        .forEach((strategy) => applyStaffingStrategy(config, strategy));
    return {
        required: Math.max(config.total, config.morning + config.night),
        minimumMorning: config.morning,
        minimumNight: config.night,
        appliedStrategyIds: config.appliedStrategyIds,
        totalWasRaised: config.total < config.morning + config.night,
    };
}

function formatStrategyValue(value) {
    return value === null || value === undefined ? '继承' : value;
}

function renderStrategyTargetPicker() {
    const usesWeekday = strategyTypeSelect.value === 'weekday';
    const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const weekdayIndexes = [1, 2, 3, 4, 5, 6, 0];
    strategyTargetPicker.innerHTML = usesWeekday
        ? weekdayIndexes.map((dayIndex, index) => `
            <button class="strategy-target-option${strategyDraftWeekdays.has(dayIndex) ? ' active' : ''}"
                type="button" data-strategy-weekday="${dayIndex}">${weekdayNames[index]}</button>
        `).join('')
        : dates.map((date) => `
            <button class="strategy-target-option${strategyDraftDates.has(date.key) ? ' active' : ''}"
                type="button" data-strategy-date="${date.key}">${date.label} 周${date.weekday}</button>
        `).join('');
}

function renderStaffingPreview() {
    const groups = new Map();
    dates.forEach((date) => {
        const config = getDateConfig(date.key);
        const key = `${config.required}|${config.minimumMorning}|${config.minimumNight}|${config.totalWasRaised}`;
        const group = groups.get(key) || {
            dates: [],
            strategyIds: new Set(),
            ...config,
        };
        group.dates.push(`${date.label} 周${date.weekday}`);
        config.appliedStrategyIds.forEach((id) => group.strategyIds.add(id));
        groups.set(key, group);
    });
    strategyPreview.innerHTML = [...groups.values()].map((group) => {
        const sourceNames = [...group.strategyIds].map((id) =>
            state.staffing.strategies.find((strategy) => strategy.id === id)?.name
        ).filter(Boolean);
        return `
            <div class="strategy-preview-item">
                <strong>${escapeHtml(group.dates.join('、'))}</strong><br>
                总 ${group.required} / 早 ${group.minimumMorning} / 晚 ${group.minimumNight}
                ${sourceNames.length ? ` · ${escapeHtml(sourceNames.join('、'))}` : ' · 默认'}
                ${group.totalWasRaised ? ' · 总人数已按早晚最低自动抬高' : ''}
            </div>
        `;
    }).join('');
}

function openStrategyPreview() {
    renderStaffingPreview();
    strategyPreviewDialog.showModal();
}

function closeStrategyPreview() {
    strategyPreviewDialog.close();
}

function renderStaffingControls() {
    baseTotalInput.value = state.staffing.baseTotal;
    baseMorningInput.value = state.staffing.baseMorning;
    baseNightInput.value = state.staffing.baseNight;
    strategyList.innerHTML = state.staffing.strategies.length
        ? state.staffing.strategies.map((strategy) => `
            <div class="strategy-item${strategy.enabled ? '' : ' disabled'}">
                <div class="strategy-copy">
                    <strong>${escapeHtml(strategy.name)}</strong>
                    ${escapeHtml(getStrategyTargetText(strategy))}：
                    总 ${formatStrategyValue(strategy.total)}，
                    早 ${formatStrategyValue(strategy.morning)}，
                    晚 ${formatStrategyValue(strategy.night)}
                </div>
                <div class="strategy-actions">
                    <button class="strategy-action" type="button" data-edit-strategy="${strategy.id}">编辑</button>
                    <button class="strategy-action" type="button" data-toggle-strategy="${strategy.id}">
                        ${strategy.enabled ? '停用' : '启用'}
                    </button>
                    <button class="strategy-action delete" type="button" data-delete-strategy="${strategy.id}">删除</button>
                </div>
            </div>
        `).join('')
        : '<div class="strategy-empty">暂无特殊策略组</div>';
    renderStrategyTargetPicker();
    if (strategyPreviewDialog.open) {
        renderStaffingPreview();
    }
}

function syncStrategyEditorType() {
    renderStrategyTargetPicker();
}

function resetStrategyEditor() {
    editingStrategyId = '';
    strategyDraftDates = new Set();
    strategyDraftWeekdays = new Set();
    strategyTotalInput.value = '';
    strategyMorningInput.value = '';
    strategyNightInput.value = '';
    document.getElementById('addStrategyBtn').textContent = '保存策略';
    cancelStrategyEditBtn.hidden = true;
    renderStrategyTargetPicker();
}

function editStaffingStrategy(strategyId) {
    const strategy = state.staffing.strategies.find((item) => item.id === strategyId);
    if (!strategy) {
        return;
    }
    editingStrategyId = strategy.id;
    strategyTypeSelect.value = strategy.type;
    strategyDraftDates = new Set(strategy.dates);
    strategyDraftWeekdays = new Set(strategy.weekdays);
    strategyTotalInput.value = strategy.total ?? '';
    strategyMorningInput.value = strategy.morning ?? '';
    strategyNightInput.value = strategy.night ?? '';
    document.getElementById('addStrategyBtn').textContent = '更新策略';
    cancelStrategyEditBtn.hidden = false;
    renderStrategyTargetPicker();
}

function removeOverlappingStrategyTargets(strategy) {
    state.staffing.strategies = state.staffing.strategies.filter((item) => {
        if (item.id === strategy.id || item.type !== strategy.type) {
            return true;
        }
        if (strategy.type === 'weekday') {
            item.weekdays = item.weekdays.filter((dayIndex) => !strategy.weekdays.includes(dayIndex));
            item.name = getStrategyTargetText(item);
            return item.weekdays.length > 0;
        }
        item.dates = item.dates.filter((dateKey) => !strategy.dates.includes(dateKey));
        item.name = `${item.dates.length}个指定日期`;
        return item.dates.length > 0;
    });
}

function saveStaffingStrategy() {
    const type = strategyTypeSelect.value === 'weekday' ? 'weekday' : 'dates';
    try {
        const datesForStrategy = type === 'dates' ? [...strategyDraftDates].sort() : [];
        const weekdays = type === 'weekday' ? [...strategyDraftWeekdays].sort((a, b) => a - b) : [];
        if (!(datesForStrategy.length || weekdays.length)) {
            throw new Error(type === 'weekday' ? '请至少选择一个星期' : '请至少选择一个日期');
        }
        const total = parseOptionalStaffingNumber(strategyTotalInput.value);
        const morning = parseOptionalStaffingNumber(strategyMorningInput.value);
        const night = parseOptionalStaffingNumber(strategyNightInput.value);
        if (total === null && morning === null && night === null) {
            throw new Error('总人数、早班或晚班至少填写一项');
        }
        const strategy = {
            id: editingStrategyId || `staff-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: '',
            type,
            dates: datesForStrategy,
            weekdays,
            total,
            morning,
            night,
            enabled: true,
        };
        strategy.name = type === 'weekday'
            ? getStrategyTargetText(strategy)
            : `${strategy.dates.length}个指定日期`;
        const existingIndex = state.staffing.strategies.findIndex((item) => item.id === strategy.id);
        if (existingIndex >= 0) {
            strategy.enabled = state.staffing.strategies[existingIndex].enabled;
            state.staffing.strategies[existingIndex] = strategy;
        } else {
            state.staffing.strategies.push(strategy);
        }
        removeOverlappingStrategyTargets(strategy);
        resetStrategyEditor();
        renderStaffingControls();
        invalidateSolutionsForStaffingChange();
        showToast('人力策略已保存');
    } catch (error) {
        showToast(error.message);
    }
}

function renderRange() {
    const defaultTotal = Math.max(
        state.staffing.baseTotal,
        state.staffing.baseMorning + state.staffing.baseNight,
    );
    rangeText.textContent = `默认周期：${dates[0].full} 至 ${dates[dates.length - 1].full}，满勤 ${getRequiredAttendanceDays()} 天；默认每日总人数至少 ${defaultTotal} 人（早 ${state.staffing.baseMorning} / 晚 ${state.staffing.baseNight}）。`;
}

function renderPeople() {
    peopleList.innerHTML = state.people.map((person) => {
        const stats = getPersonStats(person.id);
        const active = person.id === state.openPersonId ? ' active' : '';
        const currentShift = getPreferenceShift(person.id);
        const currentMode = getPreferenceMode(person.id);
        const shiftPreference = getShiftPreference(person.id);
        const forcedShiftChoice = getForcedShiftChoice(person.id);
        const forceEnabled = isForcedShiftEnabled(person.id);
        const isRestMode = currentShift === 'rest';
        const conflicts = getPersonConflictMessages(person);
        return `
            <article class="person-card${active}" data-person-id="${person.id}">
                <button class="person-card-header" type="button" data-person-toggle="${person.id}">
                    <span class="person-info">
                        <span class="person-title-line">
                            <span class="person-name">${person.name}</span>
                            <span class="person-summary-inline">已排 ${stats.workDays} 天 / 早 ${stats.morning} 晚 ${stats.night} 常 ${stats.normal}</span>
                        </span>
                        <span class="person-summary">
                            已固定 ${stats.rules} 天（休假 ${stats.vacations} 天）
                        </span>
                        ${conflicts.length ? `
                            <span class="person-conflicts" role="status" aria-label="固定规则冲突">
                                ${conflicts.slice(0, 3).map((message) => `<span class="person-conflict">冲突：${message}</span>`).join('')}
                            </span>
                        ` : ''}
                    </span>
                    <span class="avatar">${person.name.slice(0, 1)}</span>
                </button>
                <div class="fixed-row">
                    <button class="expand-toggle${active ? ' active' : ''}" type="button" data-person-toggle="${person.id}" aria-label="${active ? '收起班次偏好' : '展开班次偏好'}" aria-expanded="${active ? 'true' : 'false'}">⌄</button>
                    <div class="fixed-tags">${renderFixedTags(person.id)}</div>
                </div>
                <div class="person-preferences">
                    <div class="person-preferences-inner">
                        <div class="schedule-preference-row">
                            <div class="schedule-preference-group">
                                <span class="schedule-preference-label">偏好</span>
                                <div class="schedule-preference-tabs" aria-label="自动排班班次偏好">
                                    <button class="schedule-preference-tab${shiftPreference === 'morning' ? ' active' : ''}" type="button" data-shift-preference="morning" data-person="${person.id}">早班</button>
                                    <button class="schedule-preference-tab${shiftPreference === 'night' ? ' active' : ''}" type="button" data-shift-preference="night" data-person="${person.id}">晚班</button>
                                    <button class="schedule-preference-tab${shiftPreference === 'balanced' ? ' active' : ''}" type="button" data-shift-preference="balanced" data-person="${person.id}">均衡</button>
                                </div>
                            </div>
                            <div class="force-shift-group">
                                <button class="force-shift-toggle${forceEnabled ? ' active' : ''}" type="button"
                                    data-force-toggle data-person="${person.id}" aria-pressed="${forceEnabled}">强制</button>
                                <div class="force-shift-tabs" aria-label="强制班次">
                                    ${shifts.map((shift) => `
                                        <button class="force-shift-tab${forcedShiftChoice === shift.id ? ' active' : ''}"
                                            type="button" data-force-shift="${shift.id}" data-person="${person.id}">${shift.name}班</button>
                                    `).join('')}
                                </div>
                            </div>
                        </div>
                        <div class="shift-tabs">
                            <button class="shift-tab${currentShift === 'all' ? ' active' : ''}" type="button" data-pref-shift="all" data-person="${person.id}">
                                全天
                            </button>
                            ${shifts.map((shift) => `
                                <button class="shift-tab${currentShift === shift.id ? ' active' : ''}" type="button"
                                    data-pref-shift="${shift.id}" data-person="${person.id}"
                                    ${forceEnabled && currentMode === 'work' && shift.id !== forcedShiftChoice ? 'disabled title="强制班次开启后不能固定到其他班次"' : ''}>
                                    ${shift.name}班
                                </button>
                            `).join('')}
                            <button class="shift-tab rest${currentShift === 'rest' ? ' active' : ''}" type="button" data-pref-shift="rest" data-person="${person.id}">
                                休假
                            </button>
                        </div>
                        <div class="mode-tabs" aria-label="固定类型">
                            <button class="mode-tab work${!isRestMode && currentMode === 'work' ? ' active' : ''}" type="button" data-pref-mode="work" data-person="${person.id}"${isRestMode ? ' disabled' : ''}>固定上</button>
                            <button class="mode-tab block${isRestMode || currentMode === 'block' ? ' active' : ''}" type="button" data-pref-mode="block" data-person="${person.id}"${isRestMode ? ' disabled' : ''}>固定不上</button>
                        </div>
                        <div class="inline-date-grid">
                            ${dates.map((date) => renderPreferenceDate(person.id, date, currentShift, currentMode)).join('')}
                        </div>
                    </div>
                </div>
            </article>
        `;
    }).join('');

    syncPreferencePlacement();
}

function refreshPeopleOnly() {
    renderPeople();
}

function refreshPeopleAndCalendar() {
    renderPeople();
    renderCalendar();
}

function syncPreferencePlacement() {
    const popupWidth = Math.min(560, Math.max(260, window.innerWidth - 56));
    const viewportPadding = 16;
    peopleList.querySelectorAll('.person-card').forEach((card) => {
        const isActive = card.dataset.personId === state.openPersonId;
        let placement = 'prefs-placement-center';

        if (isActive) {
            const rect = card.getBoundingClientRect();
            const centeredLeft = rect.left + (rect.width / 2) - (popupWidth / 2);
            const centeredRight = centeredLeft + popupWidth;
            if (centeredLeft < viewportPadding) {
                placement = 'prefs-placement-left';
            } else if (centeredRight > window.innerWidth - viewportPadding) {
                placement = 'prefs-placement-right';
            }
        }

        card.classList.remove('prefs-placement-center', 'prefs-placement-left', 'prefs-placement-right');
        card.classList.add(placement);
    });
}

function getPreferenceShift(personId) {
    return state.preferenceShifts[personId] || 'morning';
}

function getPreferenceMode(personId) {
    return state.preferenceModes[personId] || 'work';
}

function getShiftPreference(personId) {
    return state.shiftPreferences[personId] || 'balanced';
}

function getForcedShiftChoice(personId) {
    const shiftId = state.forcedShiftChoices[personId];
    return shifts.some((shift) => shift.id === shiftId) ? shiftId : '';
}

function isForcedShiftEnabled(personId) {
    return Boolean(state.forcedShiftEnabled[personId] && getForcedShiftChoice(personId));
}

function getForcedShift(personId) {
    return isForcedShiftEnabled(personId) ? getForcedShiftChoice(personId) : '';
}

function renderPreferenceDate(personId, date, currentShift, currentMode) {
    const rule = getRule(personId, date.key);
    const active = currentShift === 'rest'
        ? rule.vacation
        : currentMode === 'block'
            ? rule.block.has(currentShift)
            : rule.allow.has(currentShift);
    const activeClass = active ? (currentShift === 'rest' ? ' rest-active' : currentMode === 'block' ? ' block-active' : ' active') : '';
    const shiftClass = active && currentMode === 'work' && ['morning', 'night'].includes(currentShift)
        ? ` shift-${currentShift}`
        : '';
    return `
        <button class="date-chip${activeClass}${shiftClass}" type="button" data-pref-date="${date.key}" data-person="${personId}">
            ${date.label} 周${date.weekday}
        </button>
    `;
}

function renderFixedTags(personId) {
    const tags = [];
    dates.forEach((date) => {
        const rule = getRule(personId, date.key);
        if (rule.vacation) {
            tags.push(renderFixedTag(personId, date.key, 'rest', 'rest', `${date.label} 休`));
        }
        rule.allow.forEach((shiftId) => {
            const label = shiftId === 'all'
                ? `${date.label} 全天 固定上`
                : `${date.label} ${getShiftName(shiftId)}班 固定上`;
            tags.push(renderFixedTag(personId, date.key, shiftId, 'work', label));
        });
        rule.block.forEach((shiftId) => {
            const label = shiftId === 'all'
                ? `${date.label} 全天 不上`
                : `${date.label} ${getShiftName(shiftId)}班 不上`;
            tags.push(renderFixedTag(personId, date.key, shiftId, 'block', label));
        });
    });
    return tags.length ? tags.join('') : `<button class="fixed-empty-action" type="button" data-person-toggle="${personId}">暂无固定班次，点击添加</button>`;
}

function renderFixedTag(personId, dateKey, shiftId, mode, label) {
    const restClass = shiftId === 'rest' ? ' rest' : '';
    const blockClass = mode === 'block' ? ' blocked' : '';
    const shiftClass = ['morning', 'night'].includes(shiftId) ? ` shift-${shiftId}` : '';
    return `
        <span class="fixed-tag${restClass}${blockClass}${shiftClass}">${label}</span>
    `;
}

function togglePreferenceDate(personId, dateKey) {
    const shiftId = getPreferenceShift(personId);
    const mode = getPreferenceMode(personId);
    const rule = getRule(personId, dateKey);
    if (shiftId === 'rest') {
        if (rule.vacation) {
            removePreference(personId, dateKey, 'rest', 'rest');
        } else {
            setVacation(personId, dateKey);
        }
    } else if (mode === 'block') {
        if (rule.block.has(shiftId)) {
            removePreference(personId, dateKey, shiftId, 'block');
        } else {
            setBlockedShift(personId, dateKey, shiftId);
        }
    } else if (rule.allow.has(shiftId)) {
        removePreference(personId, dateKey, shiftId, 'work');
    } else {
        setFixedShift(personId, dateKey, shiftId);
    }
}

function setVacation(personId, dateKey) {
    const rule = getRule(personId, dateKey);
    rule.vacation = true;
    rule.allow.clear();
    rule.block.clear();
    removePersonFromDate(personId, dateKey);
}

function setFixedShift(personId, dateKey, shiftId, origin = 'preference') {
    const rule = getRule(personId, dateKey);
    rule.vacation = false;
    if (shiftId === 'all') {
        rule.block.delete('all');
        rule.allow.clear();
        rule.allow.add('all');
        removePersonFromDate(personId, dateKey);
        return;
    }
    const effectiveShiftId = getForcedShift(personId) || shiftId;
    rule.block.delete(effectiveShiftId);
    rule.block.delete('all');
    rule.allow.clear();
    rule.allow.add(effectiveShiftId);
    removePersonFromDate(personId, dateKey);
    getAssignment(dateKey, effectiveShiftId).push(personId);
    const key = assignmentKey(dateKey, effectiveShiftId, personId);
    state.locked[key] = true;
    state.lockOrigins[key] = origin;
}

function migrateFixedAssignmentsToForcedShift(personId) {
    const forcedShift = getForcedShift(personId);
    if (!forcedShift) {
        return 0;
    }
    let migrated = 0;
    dates.forEach((date) => {
        const rule = getRule(personId, date.key);
        const fixedShift = [...rule.allow].find((shiftId) =>
            shiftId !== 'all' && shifts.some((shift) => shift.id === shiftId)
        );
        if (!fixedShift || fixedShift === forcedShift) {
            return;
        }
        const origin = state.lockOrigins[assignmentKey(date.key, fixedShift, personId)] || 'preference';
        setFixedShift(personId, date.key, forcedShift, origin);
        migrated += 1;
    });
    return migrated;
}

function setBlockedShift(personId, dateKey, shiftId) {
    const rule = getRule(personId, dateKey);
    rule.vacation = false;
    if (shiftId === 'all') {
        rule.allow.clear();
        rule.block.clear();
        rule.block.add('all');
        removePersonFromDate(personId, dateKey);
        return;
    }
    rule.allow.delete(shiftId);
    rule.allow.delete('all');
    rule.block.add(shiftId);
    state.assignments[dateKey] ||= {};
    state.assignments[dateKey][shiftId] = (state.assignments[dateKey][shiftId] || []).filter((id) => id !== personId);
    const key = assignmentKey(dateKey, shiftId, personId);
    delete state.locked[key];
    delete state.lockOrigins[key];
}

function removePreference(personId, dateKey, shiftId, mode = 'work') {
    const rule = getRule(personId, dateKey);
    if (shiftId === 'rest') {
        rule.vacation = false;
        return;
    }
    if (mode === 'block') {
        rule.block.delete(shiftId);
    } else {
        rule.allow.delete(shiftId);
        if (shiftId !== 'all') {
            state.assignments[dateKey] ||= {};
            state.assignments[dateKey][shiftId] = (state.assignments[dateKey][shiftId] || []).filter((id) => id !== personId);
            const key = assignmentKey(dateKey, shiftId, personId);
            delete state.locked[key];
            delete state.lockOrigins[key];
        }
    }
}

function closeAssignmentActionMenu() {
    document.querySelector('.assignment-action-menu')?.remove();
}

function clearSchedulePersonHighlight() {
    highlightedSchedulePersonId = '';
    calendarWrap.querySelectorAll('.person-participation-highlight').forEach((cell) => {
        cell.classList.remove('person-participation-highlight');
    });
    calendarWrap.querySelectorAll('[data-lock][aria-pressed="true"]').forEach((button) => {
        button.setAttribute('aria-pressed', 'false');
    });
}

function highlightSchedulePerson(personId) {
    clearSchedulePersonHighlight();
    if (state.viewMode !== 'shift') return;
    highlightedSchedulePersonId = personId;
    calendarWrap.querySelectorAll('[data-lock][data-person]').forEach((button) => {
        if (button.dataset.person !== personId) return;
        button.setAttribute('aria-pressed', 'true');
        button.closest('td.cell')?.classList.add('person-participation-highlight');
    });
}

function deleteAssignment(personId, dateKey, shiftId) {
    state.assignments[dateKey] ||= {};
    state.assignments[dateKey][shiftId] = (state.assignments[dateKey][shiftId] || [])
        .filter((id) => id !== personId);
    const key = assignmentKey(dateKey, shiftId, personId);
    delete state.locked[key];
    delete state.lockOrigins[key];
    getRule(personId, dateKey).allow.delete(shiftId);
}

function unlockAssignment(personId, dateKey, shiftId) {
    const key = assignmentKey(dateKey, shiftId, personId);
    delete state.locked[key];
    delete state.lockOrigins[key];
    getRule(personId, dateKey).allow.delete(shiftId);
}

function showAssignmentActionMenu(anchor) {
    closeAssignmentActionMenu();
    const personId = anchor.dataset.person;
    const dateKey = anchor.dataset.date;
    const shiftId = anchor.dataset.shift;
    const key = assignmentKey(dateKey, shiftId, personId);
    const isLocked = Boolean(state.locked[key]);
    const menu = document.createElement('div');
    menu.className = 'assignment-action-menu';
    if (isLocked) {
        menu.innerHTML = `
            <button class="assignment-action" type="button" data-assignment-unlock-action>取消固定</button>
            <button class="assignment-action delete" type="button" data-assignment-delete-action>删除</button>
        `;
        menu.querySelector('[data-assignment-unlock-action]').addEventListener('click', (event) => {
            event.stopPropagation();
            unlockAssignment(personId, dateKey, shiftId);
            showToast('已取消固定，保留当前排班');
            closeAssignmentActionMenu();
            clearSchedulePersonHighlight();
            refreshPeopleAndCalendar();
        });
    } else {
        menu.innerHTML = `
            <button class="assignment-action" type="button" data-assignment-lock-action>固定</button>
            <button class="assignment-action delete" type="button" data-assignment-delete-action>删除</button>
        `;
        menu.querySelector('[data-assignment-lock-action]').addEventListener('click', (event) => {
            event.stopPropagation();
            setFixedShift(personId, dateKey, shiftId, 'calendar');
            showToast('已固定该排班');
            closeAssignmentActionMenu();
            clearSchedulePersonHighlight();
            refreshPeopleAndCalendar();
        });
    }

    menu.querySelector('[data-assignment-delete-action]')?.addEventListener('click', (event) => {
        event.stopPropagation();
        deleteAssignment(personId, dateKey, shiftId);
        showToast(isLocked ? '已删除固定班次' : '已删除该排班');
        closeAssignmentActionMenu();
        clearSchedulePersonHighlight();
        refreshPeopleAndCalendar();
    });

    document.body.appendChild(menu);
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(
        Math.max(12, anchorRect.left + (anchorRect.width - menuRect.width) / 2),
        window.innerWidth - menuRect.width - 12,
    );
    const preferredTop = anchorRect.bottom + 6;
    const top = preferredTop + menuRect.height <= window.innerHeight - 12
        ? preferredTop
        : Math.max(12, anchorRect.top - menuRect.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function removeFrozenScheduleHeader() {
    if (frozenHeaderFrame) {
        cancelAnimationFrame(frozenHeaderFrame);
        frozenHeaderFrame = 0;
    }
    frozenScheduleHeader?.remove();
    frozenScheduleHeader = null;
}

function syncFrozenScheduleHeader() {
    if (!frozenScheduleHeader || state.viewMode !== 'person') return;
    const table = calendarWrap.querySelector('.schedule-table');
    const sourceHeader = table?.querySelector('tr');
    const track = frozenScheduleHeader.querySelector('.frozen-schedule-header-track');
    if (!table || !sourceHeader || !track) {
        removeFrozenScheduleHeader();
        return;
    }

    const wrapRect = calendarWrap.getBoundingClientRect();
    const tableRect = table.getBoundingClientRect();
    const shouldShow = tableRect.top < 0 && tableRect.bottom > 0;
    frozenScheduleHeader.style.left = `${wrapRect.left}px`;
    frozenScheduleHeader.style.width = `${wrapRect.width}px`;
    track.style.transform = `translateX(${-calendarWrap.scrollLeft}px)`;
    frozenScheduleHeader.classList.toggle('visible', shouldShow);
}

function scheduleFrozenHeaderSync() {
    if (frozenHeaderFrame) return;
    frozenHeaderFrame = requestAnimationFrame(() => {
        frozenHeaderFrame = 0;
        syncFrozenScheduleHeader();
    });
}

function rebuildFrozenScheduleHeader() {
    removeFrozenScheduleHeader();
    if (state.viewMode !== 'person') return;
    const table = calendarWrap.querySelector('.schedule-table');
    const sourceHeader = table?.querySelector('tr');
    if (!table || !sourceHeader) return;

    const overlay = document.createElement('div');
    overlay.className = 'frozen-schedule-header';
    overlay.setAttribute('aria-hidden', 'true');
    const frozenTable = document.createElement('table');
    frozenTable.className = 'schedule-table frozen-schedule-header-table';
    const headerClone = sourceHeader.cloneNode(true);
    const sourceCells = [...sourceHeader.children];
    [...headerClone.children].forEach((cell, index) => {
        const width = sourceCells[index].getBoundingClientRect().width;
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
    });
    frozenTable.style.width = `${table.scrollWidth}px`;
    frozenTable.appendChild(headerClone);

    const track = document.createElement('div');
    track.className = 'frozen-schedule-header-track';
    track.appendChild(frozenTable);
    overlay.appendChild(track);

    const corner = headerClone.firstElementChild.cloneNode(true);
    corner.className = 'frozen-schedule-header-corner row-head';
    corner.style.width = `${sourceCells[0].getBoundingClientRect().width}px`;
    overlay.appendChild(corner);
    document.body.appendChild(overlay);
    frozenScheduleHeader = overlay;
    syncFrozenScheduleHeader();
}

function renderCalendar() {
    removeFrozenScheduleHeader();
    calendarTitle.textContent = state.viewMode === 'shift' ? '日历排班：班次视图' : '日历排班：人员视图';
    const rows = state.viewMode === 'shift'
        ? shifts.map((shift) => ({ id: shift.id, label: `${shift.name}班`, type: 'shift' }))
        : state.people.map((person) => ({ id: person.id, label: person.name, type: 'person' }));

    const header = `
        <tr>
            <th class="row-head"></th>
            ${dates.map((date) => `
                <th>
                    ${renderDateHeader(date)}
                </th>
            `).join('')}
        </tr>
    `;

    const body = rows.map((row) => `
        <tr>
            <th class="row-head">${row.label}</th>
            ${dates.map((date) => `<td class="cell" data-cell-type="${row.type}" data-row-id="${row.id}" data-date="${date.key}">${renderCell(row, date.key)}</td>`).join('')}
        </tr>
    `).join('');

    calendarWrap.innerHTML = `<table class="schedule-table">${header}${body}</table>`;
    calendarWrap.querySelectorAll('[data-lock]').forEach((item) => {
        item.addEventListener('click', (event) => {
            event.stopPropagation();
            if (state.viewMode === 'shift') {
                highlightSchedulePerson(item.dataset.person);
            }
            showAssignmentActionMenu(item);
        });
    });
    calendarWrap.querySelectorAll('[data-block]').forEach((item) => {
        item.addEventListener('click', () => {
            showToast('固定不上只能在人员固定班次中修改');
        });
    });
    calendarWrap.querySelectorAll('[data-day-rule]').forEach((item) => {
        item.addEventListener('click', () => {
            showToast('该固定规则只能在人员固定班次中修改');
        });
    });
    if (highlightedSchedulePersonId) {
        highlightSchedulePerson(highlightedSchedulePersonId);
    }
    requestAnimationFrame(rebuildFrozenScheduleHeader);
}

function renderDateHeader(date) {
    const staffing = getDateConfig(date.key);
    const rules = state.people.flatMap((person) => {
        const rule = getRule(person.id, date.key);
        const items = [];
        if (rule.allow.has('all')) {
            items.push(renderDayRulePill(person.id, date.key, 'work', `${person.name} 全天可上`));
        }
        if (rule.block.has('all')) {
            items.push(renderDayRulePill(person.id, date.key, 'block', `${person.name} 全天不上`));
        }
        if (rule.vacation) {
            items.push(renderDayRulePill(person.id, date.key, 'rest', `${person.name} 休假`));
        }
        return items;
    }).join('');

    return `
        <span class="date-head">
            <strong>${date.label}</strong>
            <span class="weekday">周${date.weekday}</span>
            <span class="weekday">需 早${staffing.minimumMorning} / 晚${staffing.minimumNight} / 总${staffing.required}</span>
            ${rules ? `<span class="date-rule-list">${rules}</span>` : ''}
        </span>
    `;
}

function renderDayRulePill(personId, dateKey, mode, label) {
    const blockedClass = mode === 'block' ? ' blocked' : '';
    const restClass = mode === 'rest' ? ' rest' : '';
    return `<button class="date-rule-pill${blockedClass}${restClass}" type="button" data-day-rule data-person="${personId}" data-date="${dateKey}" data-mode="${mode}">${label}<span class="pill-delete">×</span></button>`;
}

function renderCell(row, dateKey) {
    if (row.type === 'shift') {
        const assigned = getAssignment(dateKey, row.id);
        const blocked = getBlockedPeople(dateKey, row.id);
        if (!assigned.length && !blocked.length) {
            return '<span class="empty">待排</span>';
        }
        return `<div class="cell-person-list">
            ${assigned.map((personId) => renderPersonPill(dateKey, row.id, personId)).join('')}
            ${blocked.map((personId) => renderBlockedPill(dateKey, row.id, personId, `${personName(personId)} 不上`)).join('')}
        </div>`;
    }

    const shiftsForPerson = shifts.filter((shift) => getAssignment(dateKey, shift.id).includes(row.id));
    const rule = getRule(row.id, dateKey);
    const blockedShifts = shifts.filter((shift) => rule.block.has(shift.id));
    if (rule.vacation) {
        return '<span class="pill warning">休假</span>';
    }
    if (!shiftsForPerson.length && !blockedShifts.length) {
        return '<span class="empty">休</span>';
    }
    return `<div class="cell-person-list">
        ${shiftsForPerson.map((shift) => renderPersonShiftPill(dateKey, shift.id, row.id)).join('')}
        ${blockedShifts.map((shift) => renderBlockedPill(dateKey, shift.id, row.id, `不上${shift.name}班`)).join('')}
    </div>`;
}

function renderPersonPill(dateKey, shiftId, personId) {
    const locked = state.locked[assignmentKey(dateKey, shiftId, personId)] ? ' locked' : '';
    return `<button class="pill${locked}" type="button" data-lock data-date="${dateKey}" data-shift="${shiftId}" data-person="${personId}">${personName(personId)}${locked ? ' 固定' : ''}</button>`;
}

function renderPersonShiftPill(dateKey, shiftId, personId) {
    const shift = shifts.find((item) => item.id === shiftId);
    const locked = state.locked[assignmentKey(dateKey, shiftId, personId)] ? ' locked' : '';
    return `<button class="pill${locked}" type="button" data-lock data-date="${dateKey}" data-shift="${shiftId}" data-person="${personId}">${shift.name}班${locked ? ' 固定' : ''}</button>`;
}

function renderBlockedPill(dateKey, shiftId, personId, label) {
    return `<button class="pill blocked" type="button" data-block data-date="${dateKey}" data-shift="${shiftId}" data-person="${personId}">${label}<span class="pill-delete">×</span></button>`;
}

function getBlockedPeople(dateKey, shiftId) {
    return state.people
        .filter((person) => getRule(person.id, dateKey).block.has(shiftId))
        .map((person) => person.id);
}

function closeManualMenu() {
    document.querySelector('.manual-menu')?.remove();
}

function showManualMenu(cell) {
    closeManualMenu();
    const dateKey = cell.dataset.date;
    const rowId = cell.dataset.rowId;
    const cellType = cell.dataset.cellType;
    if (cellType === 'person') {
        const reason = getManualEditBlockReason(rowId, dateKey);
        if (reason) {
            showToast(reason);
            return;
        }
    }
    const options = cellType === 'shift'
        ? state.people.map((person) => ({
            id: person.id,
            label: person.name,
            blockedReason: getManualEditBlockReason(person.id, dateKey, rowId),
        }))
        : shifts.map((shift) => ({
            id: shift.id,
            label: `${shift.name}班`,
            blockedReason: getForcedShift(rowId) && getForcedShift(rowId) !== shift.id
                ? `该人员已强制${getShiftName(getForcedShift(rowId))}班`
                : '',
        }));
    const title = cellType === 'shift' ? '选择排班人员' : '选择分配班次';

    const menu = document.createElement('div');
    menu.className = 'manual-menu';
    menu.innerHTML = `
        <div class="manual-menu-title">${title}</div>
        <div class="manual-option-list">
            ${options.map((option) => `
                <button class="manual-option" type="button" data-option-id="${option.id}"
                    ${option.blockedReason ? `disabled title="${escapeHtml(option.blockedReason)}"` : ''}>
                    ${option.label}${option.blockedReason ? '（不可选）' : ''}
                </button>
            `).join('')}
        </div>
    `;

    menu.querySelectorAll('[data-option-id]').forEach((button) => {
        button.addEventListener('click', () => {
            if (button.disabled) return;
            if (cellType === 'shift') {
                setFixedShift(button.dataset.optionId, dateKey, rowId, 'calendar');
            } else {
                setFixedShift(rowId, dateKey, button.dataset.optionId, 'calendar');
            }
            closeManualMenu();
            showToast('已手动固定排班');
            refreshPeopleAndCalendar();
        });
    });

    document.body.appendChild(menu);
    const cellRect = cell.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.min(
        Math.max(12, cellRect.left),
        window.innerWidth - menuRect.width - 12,
    );
    const preferredTop = cellRect.bottom + 6;
    const top = preferredTop + menuRect.height <= window.innerHeight - 12
        ? preferredTop
        : Math.max(12, cellRect.top - menuRect.height - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
}

function renderSolutions() {
    solutionList.innerHTML = state.solutions.length
        ? state.solutions.map((solution, index) => `
            <div class="solution-card${index === state.activeSolutionIndex ? ' active' : ''}">
                <div>
                    <strong>${escapeHtml(solution.name || `方案 ${index + 1}`)}</strong>
                    <span class="solution-source${solution.source === 'ai' ? ' ai' : ''}">${solution.source === 'ai' ? 'AI' : '本地'}</span>
                    <p class="muted">共 ${solution.filled} 个在班坑位，满勤目标 ${getRequiredAttendanceDays()} 天，排班+带薪休假 ${solution.minAttendanceDays}-${solution.maxAttendanceDays} 天，额外出勤 ${solution.minExtraDays}-${solution.maxExtraDays} 天，评分 ${solution.score}，个人得分方差 ${Number(solution.personalScoreVariance || 0).toFixed(2)}${solution.softViolations?.length ? `，软约束偏差 ${solution.softViolations.length} 项` : ''}</p>
                    ${solution.summary ? `<p class="muted">${escapeHtml(solution.summary)}</p>` : ''}
                </div>
                <button class="btn ghost" type="button" data-solution-index="${index}">查看</button>
            </div>
        `).join('')
        : state.diagnostics.lastSolve?.blocking?.length || state.diagnostics.lastSolve?.warnings?.length
            ? `<div class="rule-item">
                <strong>最近一次求解诊断</strong>
                <p class="muted">${[
                    ...(state.diagnostics.lastSolve.blocking || []),
                    ...(state.diagnostics.lastSolve.warnings || []),
                ].slice(0, 8).join('<br>')}</p>
            </div>`
            : '<div class="rule-item">暂无候选方案，点击“自动排班”后生成。</div>';

    solutionList.querySelectorAll('[data-solution-index]').forEach((button) => {
        button.addEventListener('click', () => {
            const index = Number(button.dataset.solutionIndex);
            state.assignments = cloneAssignments(state.solutions[index].assignments);
            state.activeSolutionIndex = index;
            renderAll();
        });
    });
}

function normalizeTableCell(value) {
    return sanitizeText(value).replace(/[\t\r\n]+/g, ' ').trim();
}

function getPersonDayExportValue(personId, dateKey) {
    if (getRule(personId, dateKey).vacation) {
        return '休';
    }
    const assignedShift = shifts.find((shift) =>
        getAssignment(dateKey, shift.id).includes(personId)
    );
    return assignedShift?.name || '休';
}

function buildPersonViewScheduleText() {
    const header = [
        '人员',
        ...dates.map((date) => `${date.label}周${date.weekday}`),
    ];
    const rows = state.people.map((person) => [
        normalizeTableCell(person.name),
        ...dates.map((date) => getPersonDayExportValue(person.id, date.key)),
    ]);
    return [header, ...rows].map((row) => row.join('\t')).join('\n');
}

async function copyTextToClipboard(text) {
    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(text);
            return;
        } catch {
            // Fall back to the selection-based copy path below.
        }
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) {
        throw new Error('浏览器阻止了剪贴板写入');
    }
}

function downloadScheduleText(text) {
    const blob = new Blob([text], { type: 'text/tab-separated-values;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${formatArchiveTimestamp()}-人员视图排班.tsv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

async function exportScheduleText() {
    const text = buildPersonViewScheduleText();
    try {
        await copyTextToClipboard(text);
        showToast('已复制人员视图排班，可直接粘贴到表格');
    } catch (error) {
        downloadScheduleText(text);
        showToast('剪贴板受限，已下载 TSV 表格文件');
    }
}

function getShiftName(shiftId) {
    if (shiftId === 'all') {
        return '全天';
    }
    return shifts.find((shift) => shift.id === shiftId)?.name || '';
}

function getPersonStats(personId) {
    const stats = { workDays: 0, morning: 0, normal: 0, night: 0, rules: 0, vacations: 0 };
    dates.forEach((date) => {
        let worked = false;
        shifts.forEach((shift) => {
            if (getAssignment(date.key, shift.id).includes(personId)) {
                stats[shift.id] += 1;
                worked = true;
            }
        });
        const rule = getRule(personId, date.key);
        if (!rule.vacation && (rule.allow.size || rule.block.size)) {
            stats.rules += 1;
        }
        if (rule.vacation) {
            stats.vacations += 1;
        }
        if (worked) {
            stats.workDays += 1;
        }
    });
    return stats;
}

function removePersonFromDate(personId, dateKey) {
    shifts.forEach((shift) => {
        state.assignments[dateKey] ||= {};
        state.assignments[dateKey][shift.id] = (state.assignments[dateKey][shift.id] || []).filter((id) => id !== personId);
        const key = assignmentKey(dateKey, shift.id, personId);
        delete state.locked[key];
        delete state.lockOrigins[key];
    });
}

function clearAssignments(keepLocked = true) {
    const lockedAssignments = {};
    if (keepLocked) {
        Object.keys(state.locked).forEach((key) => {
            const [dateKey, shiftId, personId] = key.split('|');
            lockedAssignments[dateKey] ||= {};
            lockedAssignments[dateKey][shiftId] ||= [];
            lockedAssignments[dateKey][shiftId].push(personId);
        });
    }
    state.assignments = lockedAssignments;
    state.solutions = [];
    state.activeSolutionIndex = -1;
    renderAll();
}

function getSolutionSignature(assignments) {
    return JSON.stringify(sanitizeAssignments(
        assignments,
        new Set(state.people.map((person) => person.id)),
        dates.map((date) => date.key),
    ));
}

function createSolutionRecord(assignments, metadata = {}) {
    const attendanceLoads = state.people.map((person) => {
        const targets = getPersonWorkloadTargets(person.id);
        return getWorkDays(assignments, person.id) + targets.paidLeaveDays;
    });
    const extraLoads = attendanceLoads.map((attendanceDays) =>
        Math.max(0, attendanceDays - getRequiredAttendanceDays())
    );
    const personalScoreStats = getPersonalScoreStats(assignments);
    return {
        assignments: cloneAssignments(assignments),
        filled: countAssignedSlots(assignments),
        score: Math.round(scoreSchedule(assignments)),
        personalScoreAverage: Number(personalScoreStats.average.toFixed(2)),
        personalScoreVariance: Number(personalScoreStats.variance.toFixed(2)),
        personalScores: personalScoreStats.scores.map((item) => ({
            ...item,
            score: Number(item.score.toFixed(2)),
        })),
        minAttendanceDays: Math.min(...attendanceLoads),
        maxAttendanceDays: Math.max(...attendanceLoads),
        minExtraDays: Math.min(...extraLoads),
        maxExtraDays: Math.max(...extraLoads),
        softViolations: getSoftConstraintViolations(assignments),
        source: metadata.source === 'ai' ? 'ai' : 'local',
        name: sanitizeText(metadata.name || '').slice(0, 80),
        summary: sanitizeText(metadata.summary || '').slice(0, 300),
    };
}

function buildAiScheduleInput(localSolutions, acceptedSolutions = [], repair = null) {
    return {
        v: 2,
        task: 'schedule',
        dates: dates.map((date) => {
            const config = getDateConfig(date.key);
            return [
                date.key,
                config.required,
                config.minimumMorning,
                config.minimumNight,
            ];
        }),
        people: state.people.map((person) => {
            const targets = getPersonWorkloadTargets(person.id);
            return [
                person.id,
                getShiftPreference(person.id),
                getForcedShift(person.id) || '',
                targets.targetWorkDays,
                targets.maximumWorkDays,
                targets.paidLeaveDays,
            ];
        }),
        rules: serializeCompactAiRules(),
        locked: collectLockedAssignments().map((item) => [
            item.personId,
            item.dateKey,
            item.shiftId,
        ]),
        baseline: localSolutions[0] ? {
            score: localSolutions[0].score,
            days: encodeCompactAssignments(localSolutions[0].assignments),
        } : null,
        avoid: acceptedSolutions.slice(-1).map((solution) =>
            encodeCompactAssignments(solution.assignments)
        ),
        repair: repair ? {
            errors: repair.violations.slice(0, 20),
            days: encodeCompactAssignments(repair.assignments),
        } : null,
        format: {
            root: 'solutions',
            solution: ['n', 's', 'd'],
            d: 'one entry per dates item: [morningIds,normalIds,nightIds]',
        },
    };
}

function serializeCompactAiRules() {
    const rules = [];
    Object.entries(state.rules).forEach(([personId, personRules]) => {
        Object.entries(personRules).forEach(([dateKey, rule]) => {
            if (!rule.vacation && !rule.allow.size && !rule.block.size) {
                return;
            }
            rules.push([
                personId,
                dateKey,
                [...rule.allow],
                [...rule.block],
                Number(Boolean(rule.vacation)),
            ]);
        });
    });
    return rules;
}

async function requestAiScheduleSolutions(localSolutions, signal) {
    if (!DEEPSEEK_PROXY_API_URL) {
        throw new Error('未配置 DeepSeek AI 服务代理地址');
    }
    const rewardRules = await loadScheduleRewardRules(signal);
    const validPeople = new Set(state.people.map((person) => person.id));
    const validDates = dates.map((date) => date.key);
    const accepted = [];
    const validDuplicates = [];
    let rejected = 0;
    let repair = null;
    let parseFailures = 0;
    const maximumAttempts = localSolutions.length ? 9 : 15;

    for (let attempt = 0; attempt < maximumAttempts && accepted.length < AI_SOLUTION_COUNT; attempt += 1) {
        if (signal.aborted) {
            throw new DOMException('AI 排班已中断', 'AbortError');
        }
        const input = {
            ...buildAiScheduleInput(localSolutions, accepted, repair),
            rewardRules,
        };
        let result;
        try {
            result = await callDeepSeekJson(input, signal);
            parseFailures = 0;
        } catch (error) {
            if (!/JSON|截断/.test(error.message) || parseFailures >= 2) {
                throw error;
            }
            parseFailures += 1;
            rejected += 1;
            repair = {
                assignments: {},
                violations: ['上次响应不是完整有效的 JSON，请严格按 format 返回紧凑且完整的 d 数组'],
            };
            continue;
        }
        const solution = Array.isArray(result.solutions) ? result.solutions[0] : null;
        if (!solution?.assignments) {
            if (typeof result.error === 'string' && result.error.trim()) {
                throw new Error(sanitizeText(result.error).slice(0, 300));
            }
            repair = {
                assignments: {},
                violations: ['返回结果缺少完整 d，请按 dates 顺序为每个日期生成[早班,常班,晚班]三个数组'],
            };
            rejected += 1;
            continue;
        }
        const assignments = sanitizeAssignments(solution?.assignments, validPeople, validDates);
        const violations = getHardConstraintViolations(assignments);
        if (violations.length) {
            repair = { assignments, violations: violations.slice(0, 40) };
            rejected += 1;
            continue;
        }
        const signature = getSolutionSignature(assignments);
        const record = createSolutionRecord(assignments, {
            source: 'ai',
            name: solution?.name || `AI 方案 ${accepted.length + 1}`,
            summary: solution?.summary || '由 AI 根据奖励规则生成并通过本地硬约束校验。',
        });
        if (accepted.some((item) => getSolutionSignature(item.assignments) === signature)) {
            rejected += 1;
            repair = {
                assignments,
                violations: ['方案与已接纳的 AI 方案完全相同，请在保持全部硬约束的前提下调整排班'],
            };
            continue;
        }
        if (localSolutions.some((item) => getSolutionSignature(item.assignments) === signature)) {
            validDuplicates.push(record);
            repair = {
                assignments,
                violations: ['方案与本地基准方案完全相同，请保持硬约束并生成不同排法'],
            };
            rejected += 1;
            continue;
        }
        accepted.push(record);
        repair = null;
    }

    if (!accepted.length && validDuplicates.length) {
        accepted.push(validDuplicates[0]);
    }
    return { accepted, rejected };
}

function mergeScheduleSolutions(...solutionGroups) {
    const merged = [];
    solutionGroups.flat().forEach((solution) => {
        const signature = getSolutionSignature(solution.assignments);
        if (!merged.some((item) => getSolutionSignature(item.assignments) === signature)) {
            merged.push(solution);
        }
    });
    return merged.sort((a, b) => b.score - a.score).slice(0, 10);
}

async function solveLocalSchedules() {
    if (localSolveRunning) return;
    localSolveRunning = true;
    const preflight = analyzeFixedRuleConflicts();
    state.diagnostics.lastSolve = preflight;
    solveBtn.disabled = true;
    solveBtn.textContent = '本地排班中...';
    setAiSolveStatus('正在生成本地候选方案...');

    if (preflight.blocking.length) {
        state.solutions = [];
        state.activeSolutionIndex = -1;
        setAiSolveStatus(`无可行解：${preflight.blocking.slice(0, 3).join('；')}`, true);
        showToast(formatScheduleConflictReport(preflight));
        localSolveRunning = false;
        solveBtn.disabled = false;
        solveBtn.textContent = '本地排班';
        renderAll();
        return;
    }

    try {
        const results = [];
        const currentAssignments = sanitizeAssignments(
            state.assignments,
            new Set(state.people.map((person) => person.id)),
            dates.map((date) => date.key),
        );
        if (countAssignedSlots(currentAssignments) && validateHardConstraints(currentAssignments)) {
            results.push(createSolutionRecord(currentAssignments, {
                source: 'local',
                name: '当前合法方案',
                summary: '排班前页面中已有的合法方案，作为本次求解保底。',
            }));
        }
        for (let seed = 0; seed < 80; seed += 1) {
            const attempt = buildSchedule(seed);
            if (attempt) {
                attempt.source = 'local';
                attempt.name = `本地方案 ${results.length + 1}`;
                attempt.summary = '由现有机械算法生成。';
                const signature = getSolutionSignature(attempt.assignments);
                if (!results.some((item) => getSolutionSignature(item.assignments) === signature)) {
                    results.push(attempt);
                }
            }
            if (seed > 0 && seed % 10 === 0) {
                await yieldToMainThread();
            }
        }

        results.sort((a, b) => b.score - a.score);
        results.splice(5);
        results.forEach((solution, index) => {
            if (solution.name.startsWith('本地方案')) {
                solution.name = `本地方案 ${index + 1}`;
                solution.summary = '由机械算法生成，并按班休紧凑度、满勤、偏好和公平性综合排序。';
            }
        });

        const existingAiSolutions = state.solutions.filter((solution) => solution.source === 'ai');
        state.solutions = mergeScheduleSolutions(results, existingAiSolutions);
        if (state.solutions.length) {
            state.assignments = cloneAssignments(state.solutions[0].assignments);
            state.activeSolutionIndex = 0;
        } else {
            const fallback = state.diagnostics.lastSolve || { blocking: [], warnings: [] };
            fallback.warnings = [
                ...(fallback.warnings || []),
                '固定项预检通过，但候选搜索未找到完整方案，可能是逐日贪心在后续日期遇到死路。',
            ];
            state.diagnostics.lastSolve = fallback;
            showToast(formatScheduleConflictReport(fallback));
        }
        setAiSolveStatus(results.length
            ? `本地排班完成：已生成 ${results.length} 个机械算法候选。`
            : '本地算法未生成可行方案。', !results.length);
        showToast(results.length
            ? `本地排班完成，共 ${results.length} 个候选方案`
            : '本次未形成可应用方案');
    } finally {
        localSolveRunning = false;
        solveBtn.disabled = false;
        solveBtn.textContent = '本地排班';
        renderAll();
    }
}

async function solveAiSchedules() {
    if (aiAbortController) return;
    const preflight = analyzeFixedRuleConflicts();
    state.diagnostics.lastSolve = preflight;
    if (preflight.blocking.length) {
        setAiSolveStatus(`无可行解：${preflight.blocking.slice(0, 3).join('；')}`, true);
        showToast(formatScheduleConflictReport(preflight));
        renderAll();
        return;
    }

    const controller = new AbortController();
    aiAbortController = controller;
    aiSolveBtn.textContent = '中断';
    aiSolveBtn.classList.add('ai-stop-btn');
    setAiSolveStatus('正在请求 AI 排班；等待期间仍可使用本地排班。');
    const baselineSolutions = state.solutions.slice(0, 5);
    try {
        const aiResult = await requestAiScheduleSolutions(baselineSolutions, controller.signal);
        state.solutions = mergeScheduleSolutions(state.solutions, aiResult.accepted);
        if (state.solutions.length) {
            state.assignments = cloneAssignments(state.solutions[0].assignments);
            state.activeSolutionIndex = 0;
        }
        if (state.solutions.length) {
            setAiSolveStatus(aiResult.accepted.length
                ? `排班完成：已获得 ${state.solutions.length} 个满足硬约束的候选，其中 ${aiResult.accepted.length} 个为 AI 优化方案。`
                : 'AI 未产生不同的新方案，已保留现有候选。');
            showToast(aiResult.accepted.length
                ? `AI 排班完成，新增 ${aiResult.accepted.length} 个候选方案`
                : 'AI 未生成不同的新方案');
        } else {
            const fallback = state.diagnostics.lastSolve || { blocking: [], warnings: [] };
            fallback.warnings = [
                ...(fallback.warnings || []),
                '预检未发现直接冲突，但 AI 多轮修复仍未构造出完整方案。',
            ];
            state.diagnostics.lastSolve = fallback;
            setAiSolveStatus('AI 排班未完成，请检查候选诊断后再次求解。', true);
            showToast('本次未形成可应用方案，原有排班未被覆盖');
        }
    } catch (error) {
        if (error.name === 'AbortError' || controller.signal.aborted) {
            setAiSolveStatus('AI 排班已中断，现有本地及候选方案不受影响。');
            showToast('已中断 AI 排班');
        } else {
            setAiSolveStatus(error.message, true);
            showToast(error.message);
        }
    } finally {
        if (aiAbortController === controller) {
            aiAbortController = null;
        }
        aiSolveBtn.disabled = false;
        aiSolveBtn.textContent = 'AI 排班';
        aiSolveBtn.classList.remove('ai-stop-btn');
        renderAll();
    }
}

function stopAiSchedule() {
    if (!aiAbortController) return;
    aiSolveBtn.disabled = true;
    setAiSolveStatus('正在中断 AI 排班...');
    aiAbortController.abort();
}

function collectLockedAssignments() {
    return Object.keys(state.locked)
        .filter((key) => state.locked[key])
        .map((key) => {
            const [dateKey, shiftId, personId] = key.split('|');
            return { dateKey, shiftId, personId };
        });
}

function analyzeFixedRuleConflicts() {
    const blocking = [];
    const warnings = [];
    const knownPeople = new Set(state.people.map((person) => person.id));
    const knownDates = new Set(dates.map((date) => date.key));
    const knownShifts = new Set(shifts.map((shift) => shift.id));
    const personDateShifts = new Map();
    const fixedWorkDays = new Map();

    collectLockedAssignments().forEach((item) => {
        const label = `${personName(item.personId)} ${item.dateKey} ${item.shiftId}`;
        if (!knownPeople.has(item.personId) || !knownDates.has(item.dateKey) || !knownShifts.has(item.shiftId)) {
            blocking.push(`固定项无效：${label}`);
            return;
        }

        const key = `${item.personId}|${item.dateKey}`;
        const existing = personDateShifts.get(key) || [];
        existing.push(item.shiftId);
        personDateShifts.set(key, existing);
        fixedWorkDays.set(item.personId, (fixedWorkDays.get(item.personId) || 0) + 1);

        const rule = getRule(item.personId, item.dateKey);
        if (rule.vacation) {
            blocking.push(`${label} 与休假冲突`);
        }
        if (rule.block.has('all') || rule.block.has(item.shiftId)) {
            blocking.push(`${label} 与固定不上冲突`);
        }
        const forcedShift = getForcedShift(item.personId);
        if (forcedShift && forcedShift !== item.shiftId) {
            blocking.push(`${label} 与强制${getShiftName(forcedShift)}班冲突`);
        }
    });

    personDateShifts.forEach((shiftIds, key) => {
        if (shiftIds.length > 1) {
            const [personId, dateKey] = key.split('|');
            blocking.push(`${personName(personId)} ${dateKey} 同时固定多个班次：${shiftIds.join('、')}`);
        }
    });

    state.people.forEach((person) => {
        const targets = getPersonWorkloadTargets(person.id);
        const fixedDays = fixedWorkDays.get(person.id) || 0;
        if (fixedDays > targets.maximumWorkDays) {
            blocking.push(`${person.name} 固定上班 ${fixedDays} 天，超过满勤允许的最多 ${targets.maximumWorkDays} 个工作日`);
        }

    });

    dates.forEach((date) => {
        const config = getDateConfig(date.key);
        const availablePeople = state.people.filter((person) =>
            shifts.some((shift) => canUseShiftByRule(person.id, date.key, shift.id))
        ).length;
        const availableMorningPeople = state.people.filter((person) =>
            canUseShiftByRule(person.id, date.key, 'morning')
        ).length;
        const availableNightPeople = state.people.filter((person) =>
            canUseShiftByRule(person.id, date.key, 'night')
        ).length;
        if (availablePeople < config.required) {
            blocking.push(`${date.key} 可用人员 ${availablePeople} 人，不足最低需求 ${config.required} 人`);
        }
        if (availableMorningPeople < config.minimumMorning) {
            blocking.push(`${date.key} 可排早班人员 ${availableMorningPeople} 人，不足早班最低 ${config.minimumMorning} 人`);
        }
        if (availableNightPeople < config.minimumNight) {
            blocking.push(`${date.key} 可排晚班人员 ${availableNightPeople} 人，不足晚班最低 ${config.minimumNight} 人`);
        }
        const coverableSlots = getCoverableStaffingSlots(date.key, config);
        if (
            availablePeople >= config.required
            && availableMorningPeople >= config.minimumMorning
            && availableNightPeople >= config.minimumNight
            && coverableSlots < config.required
        ) {
            blocking.push(`${date.key} 可用人员班次重叠，最多只能同时覆盖 ${coverableSlots} 个所需岗位`);
        }
    });

    collectLockedAssignments().forEach((item) => {
        if (
            item.shiftId === 'night'
            && hasLockedAssignment(item.personId, getAdjacentDateKey(item.dateKey, 1), 'morning')
        ) {
            blocking.push(`${personName(item.personId)} ${item.dateKey} 晚班后次日固定早班`);
        }
        if (
            item.shiftId === 'morning'
            && hasLockedAssignment(item.personId, getAdjacentDateKey(item.dateKey, 1), 'night')
        ) {
            blocking.push(`${personName(item.personId)} ${item.dateKey} 早班后次日固定晚班`);
        }
    });

    state.people.forEach((person) => {
        let consecutive = 0;
        dates.forEach((date) => {
            if (hasLockedWork(person.id, date.key)) {
                consecutive += 1;
                if (consecutive > schedulePolicy.maximumConsecutiveDays) {
                    blocking.push(`${person.name} 固定班次已形成连续超过 ${schedulePolicy.maximumConsecutiveDays} 天`);
                }
            } else {
                consecutive = 0;
            }
        });
    });

    return { blocking: [...new Set(blocking)], warnings: [...new Set(warnings)] };
}

function canUseShiftByRule(personId, dateKey, shiftId) {
    const rule = getRule(personId, dateKey);
    const forcedShift = getForcedShift(personId);
    return !rule.vacation
        && !rule.block.has('all')
        && !rule.block.has(shiftId)
        && (!forcedShift || forcedShift === shiftId)
        && (!rule.allow.size || rule.allow.has('all') || rule.allow.has(shiftId));
}

function getCoverableStaffingSlots(dateKey, config) {
    const slots = [
        ...Array.from({ length: config.minimumMorning }, () => 'morning'),
        ...Array.from({ length: config.minimumNight }, () => 'night'),
        ...Array.from(
            { length: Math.max(0, config.required - config.minimumMorning - config.minimumNight) },
            () => 'any',
        ),
    ];
    const matchedSlotByPerson = new Map();
    function canCover(personId, slot) {
        if (slot !== 'any') {
            return canUseShiftByRule(personId, dateKey, slot);
        }
        return shifts.some((shift) =>
            canUseShiftByRule(personId, dateKey, shift.id)
            && (shift.id !== 'normal' || getForcedShift(personId) === 'normal' || hasLockedAssignment(personId, dateKey, 'normal'))
        );
    }
    function assignSlot(slotIndex, visitedPeople) {
        for (const person of state.people) {
            if (visitedPeople.has(person.id) || !canCover(person.id, slots[slotIndex])) {
                continue;
            }
            visitedPeople.add(person.id);
            const previousSlot = matchedSlotByPerson.get(person.id);
            if (previousSlot === undefined || assignSlot(previousSlot, visitedPeople)) {
                matchedSlotByPerson.set(person.id, slotIndex);
                return true;
            }
        }
        return false;
    }
    let matched = 0;
    slots.forEach((slot, slotIndex) => {
        if (assignSlot(slotIndex, new Set())) {
            matched += 1;
        }
    });
    return matched;
}

function getPersonConflictMessages(person) {
    const report = state.diagnostics.lastSolve;
    if (!report) {
        return [];
    }
    return [...new Set([
        ...(report.blocking || []),
        ...(report.warnings || []),
    ].filter((message) => message.includes(person.name)))];
}

function getLockedShiftCounts(dateKey) {
    return collectLockedAssignments()
        .filter((item) => item.dateKey === dateKey)
        .reduce((counts, item) => {
            counts[item.shiftId] += 1;
            return counts;
        }, { morning: 0, normal: 0, night: 0 });
}

function hasLockedAssignment(personId, dateKey, shiftId) {
    return Boolean(dateKey && state.locked[assignmentKey(dateKey, shiftId, personId)]);
}

function hasLockedWork(personId, dateKey) {
    return shifts.some((shift) => hasLockedAssignment(personId, dateKey, shift.id));
}

function getAdjacentDateKey(dateKey, offset) {
    const index = dates.findIndex((date) => date.key === dateKey);
    return dates[index + offset]?.key || '';
}

function formatScheduleConflictReport(report) {
    if (report.blocking?.length) {
        return `固定规则冲突：${report.blocking.slice(0, 2).join('；')}`;
    }
    if (report.warnings?.length) {
        return `暂未找到方案：${report.warnings[0]}`;
    }
    return '暂未找到满足基础约束的方案，请减少固定限制后重试';
}

function buildSchedule(seed) {
    const assignments = cloneLockedAssignments();
    dates.forEach((date) => {
        assignments[date.key] ||= {};
        shifts.forEach((shift) => assignments[date.key][shift.id] ||= []);
    });

    if (state.people.some((person) =>
        getWorkDays(assignments, person.id) > getPersonWorkloadTargets(person.id).maximumWorkDays
    )) {
        return null;
    }

    const search = fillScheduleDates(assignments, 0, seed, { nodes: 0, maxNodes: 800 });
    if (!search.success) {
        return null;
    }

    balanceMonthlyWorkload(assignments, seed);
    rebalanceDailyShifts(assignments);
    if (!isScheduleValid(assignments)) {
        return null;
    }

    const score = scoreSchedule(assignments);
    const attendanceLoads = state.people.map((person) => {
        const targets = getPersonWorkloadTargets(person.id);
        return getWorkDays(assignments, person.id) + targets.paidLeaveDays;
    });
    const extraLoads = attendanceLoads.map((attendanceDays) =>
        Math.max(0, attendanceDays - getRequiredAttendanceDays())
    );
    const personalScoreStats = getPersonalScoreStats(assignments);
    return {
        assignments,
        filled: countAssignedSlots(assignments),
        score: Math.round(score),
        personalScoreAverage: Number(personalScoreStats.average.toFixed(2)),
        personalScoreVariance: Number(personalScoreStats.variance.toFixed(2)),
        personalScores: personalScoreStats.scores.map((item) => ({
            ...item,
            score: Number(item.score.toFixed(2)),
        })),
        minAttendanceDays: Math.min(...attendanceLoads),
        maxAttendanceDays: Math.max(...attendanceLoads),
        minExtraDays: Math.min(...extraLoads),
        maxExtraDays: Math.max(...extraLoads),
        softViolations: getSoftConstraintViolations(assignments),
    };
}

function fillScheduleDates(assignments, dateIndex, seed, search) {
    if (dateIndex >= dates.length) {
        return { success: true };
    }
    if (search.nodes >= search.maxNodes) {
        return { success: false };
    }

    const date = dates[dateIndex];
    const planOptions = getDatePlanOptions(date.key, seed + dateIndex);
    for (let optionIndex = 0; optionIndex < planOptions.length; optionIndex += 1) {
        search.nodes += 1;
        const snapshot = cloneAssignments(assignments);
        if (
            fillDateAssignments(
                assignments,
                date.key,
                planOptions[optionIndex],
                seed + dateIndex + optionIndex,
            )
        ) {
            const result = fillScheduleDates(assignments, dateIndex + 1, seed, search);
            if (result.success) {
                return result;
            }
        }
        restoreAssignments(assignments, snapshot);
        if (search.nodes >= search.maxNodes) {
            return { success: false };
        }
    }
    return { success: false };
}

function getDatePlanOptions(dateKey, seed = 0) {
    const config = getDateConfig(dateKey);
    const lockedCounts = getLockedShiftCounts(dateKey);
    const lockedTotal = Object.values(lockedCounts).reduce((sum, count) => sum + count, 0);
    const targetTotal = Math.max(config.required, lockedTotal);
    const availableForcedNormal = state.people.filter((person) =>
        getForcedShift(person.id) === 'normal'
        && canUseShiftByRule(person.id, dateKey, 'normal')
        && !hasLockedAssignment(person.id, dateKey, 'normal')
    ).length;
    const maximumNormal = Math.min(
        targetTotal - config.minimumMorning - config.minimumNight,
        lockedCounts.normal + availableForcedNormal,
    );
    const options = [];

    for (let normal = lockedCounts.normal; normal <= maximumNormal; normal += 1) {
        for (let night = config.minimumNight; night <= targetTotal - normal - config.minimumMorning; night += 1) {
            const morning = targetTotal - night - normal;
            if (morning >= config.minimumMorning) {
                options.push({ morning, normal, night });
            }
        }
    }

    const compatible = shuffle(options.filter((option) =>
        shifts.every((shift) => (option[shift.id] || 0) >= lockedCounts[shift.id])
    ), seed + dateKey.charCodeAt(dateKey.length - 1))
        .sort((a, b) =>
            getDailyPlanPenalty(a, lockedCounts, dateKey)
            - getDailyPlanPenalty(b, lockedCounts, dateKey)
        );

    if (compatible.length) {
        return compatible;
    }

    const fallback = { ...lockedCounts };
    while (fallback.morning < config.minimumMorning) {
        fallback.morning += 1;
    }
    while (fallback.night < config.minimumNight) {
        fallback.night += 1;
    }
    while (Object.values(fallback).reduce((sum, count) => sum + count, 0) < config.required) {
        if (fallback.morning <= fallback.night) {
            fallback.morning += 1;
        } else {
            fallback.night += 1;
        }
    }
    return [fallback];
}

function getDailyPlanPenalty(plan, lockedCounts, dateKey) {
    return Math.max(0, plan.normal - lockedCounts.normal)
        + getDailyShiftBalancePenalty(dateKey, plan.morning, plan.night);
}

function restoreAssignments(target, source) {
    Object.keys(target).forEach((dateKey) => delete target[dateKey]);
    Object.entries(source).forEach(([dateKey, dateAssignments]) => {
        target[dateKey] = {};
        Object.entries(dateAssignments).forEach(([shiftId, personIds]) => {
            target[dateKey][shiftId] = [...personIds];
        });
    });
}

function fillDateAssignments(assignments, dateKey, plan, seed) {
    const fillOrder = ['night', 'morning', 'normal'];

    for (const shiftId of fillOrder) {
        while ((assignments[dateKey][shiftId] || []).length < plan[shiftId]) {
            const candidate = pickCandidate(assignments, dateKey, shiftId, seed + fillOrder.indexOf(shiftId));
            if (!candidate) {
                return false;
            }
            assignments[dateKey][shiftId].push(candidate.id);
        }
    }

    return true;
}

function balanceMonthlyWorkload(assignments, seed) {
    let madeProgress = true;
    let pass = 0;

    while (madeProgress && pass < dates.length) {
        madeProgress = false;
        pass += 1;
        const people = shuffle([...state.people], seed + pass)
            .sort((a, b) => {
                const aTargets = getPersonWorkloadTargets(a.id);
                const bTargets = getPersonWorkloadTargets(b.id);
                const aDeficit = Math.max(0, aTargets.targetWorkDays - getWorkDays(assignments, a.id));
                const bDeficit = Math.max(0, bTargets.targetWorkDays - getWorkDays(assignments, b.id));
                return (bDeficit - aDeficit)
                    || (getWorkDays(assignments, a.id) - getWorkDays(assignments, b.id));
            });

        people.forEach((person) => {
            const targets = getPersonWorkloadTargets(person.id);
            if (getWorkDays(assignments, person.id) >= targets.preferredWorkDays) {
                return;
            }

            const option = findSupplementAssignment(assignments, person.id, seed + pass);
            if (!option) {
                return;
            }

            assignments[option.dateKey][option.shiftId].push(person.id);
            madeProgress = true;
        });
    }
}

function rebalanceDailyShifts(assignments) {
    dates.forEach((date) => {
        const allowedDifference = getAllowedDailyShiftDifference(date.key);
        let attempts = 0;
        while (attempts < state.people.length) {
            attempts += 1;
            const morning = assignments[date.key]?.morning?.length || 0;
            const night = assignments[date.key]?.night?.length || 0;
            if (Math.abs(morning - night) <= allowedDifference) {
                break;
            }
            const sourceShift = morning > night ? 'morning' : 'night';
            const targetShift = sourceShift === 'morning' ? 'night' : 'morning';
            const candidates = [...(assignments[date.key]?.[sourceShift] || [])]
                .filter((personId) => !hasLockedAssignment(personId, date.key, sourceShift))
                .map((personId) => {
                    assignments[date.key][sourceShift] = assignments[date.key][sourceShift]
                        .filter((id) => id !== personId);
                    const allowed = canAssign(assignments, personId, date.key, targetShift);
                    const preferenceCost = allowed
                        ? getCandidatePreferenceCost(assignments, personId, date.key, targetShift)
                        : Number.POSITIVE_INFINITY;
                    assignments[date.key][sourceShift].push(personId);
                    return { personId, preferenceCost };
                })
                .filter((candidate) => Number.isFinite(candidate.preferenceCost))
                .sort((a, b) => a.preferenceCost - b.preferenceCost);
            const selected = candidates[0];
            if (!selected) {
                break;
            }
            assignments[date.key][sourceShift] = assignments[date.key][sourceShift]
                .filter((id) => id !== selected.personId);
            assignments[date.key][targetShift].push(selected.personId);
        }
    });
}

function findSupplementAssignment(assignments, personId, seed) {
    const options = [];
    const forcedShift = getForcedShift(personId);
    const allowedShifts = forcedShift ? [forcedShift] : ['morning', 'night'];
    dates.forEach((date, dateIndex) => {
        if (isWorking(assignments, personId, date.key)) {
            return;
        }

        allowedShifts.forEach((shiftId) => {
            if (!canAssign(assignments, personId, date.key, shiftId)) {
                return;
            }

            const totalOnDuty = shifts.reduce(
                (sum, shift) => sum + (assignments[date.key]?.[shift.id]?.length || 0),
                0,
            );

            options.push({
                dateKey: date.key,
                shiftId,
                workPatternCost: getWorkContinuityCost(assignments, personId, date.key),
                preferenceCost: getCandidatePreferenceCost(assignments, personId, date.key, shiftId),
                shiftBalanceCost: getProjectedDailyShiftBalanceCost(assignments, date.key, shiftId),
                totalOnDuty,
                tieBreaker: (dateIndex + seed + personId.length + shiftId.length) % dates.length,
            });
        });
    });

    options.sort((a, b) =>
        (
            a.workPatternCost
            + a.shiftBalanceCost
            + (a.preferenceCost * 2)
            + (a.totalOnDuty * 0.25)
        ) - (
            b.workPatternCost
            + b.shiftBalanceCost
            + (b.preferenceCost * 2)
            + (b.totalOnDuty * 0.25)
        )
        || (a.tieBreaker - b.tieBreaker)
    );
    return options[0] || null;
}

function countAssignedSlots(assignments) {
    return dates.reduce((total, date) =>
        total + shifts.reduce(
            (dayTotal, shift) => dayTotal + (assignments[date.key]?.[shift.id]?.length || 0),
            0,
        ),
    0);
}

function isScheduleValid(assignments) {
    return validateHardConstraints(assignments);
}

function getHardConstraintViolations(assignments) {
    const violations = [];
    state.people.forEach((person) => {
        const workDays = getWorkDays(assignments, person.id);
        const targets = getPersonWorkloadTargets(person.id);
        const attendanceDays = workDays + targets.paidLeaveDays;
        if (attendanceDays > targets.maximumAttendanceDays) {
            violations.push(`${person.name} 超出最多工作天数 ${attendanceDays - targets.maximumAttendanceDays} 天`);
        }
        let consecutiveDays = 0;
        for (let index = 0; index < dates.length; index += 1) {
            const dateKey = dates[index].key;
            const rule = getRule(person.id, dateKey);
            const assignedShifts = shifts.filter((shift) =>
                assignments[dateKey]?.[shift.id]?.includes(person.id)
            );
            if ((rule.vacation || rule.block.has('all')) && assignedShifts.length) {
                violations.push(`${person.name} ${dateKey} 与${rule.vacation ? '休假' : '全天不上'}冲突`);
            }
            if (assignedShifts.some((shift) => rule.block.has(shift.id))) {
                violations.push(`${person.name} ${dateKey} 被排入固定不上班次`);
            }
            const forcedShift = getForcedShift(person.id);
            if (forcedShift && assignedShifts.some((shift) => shift.id !== forcedShift)) {
                violations.push(`${person.name} ${dateKey} 违反强制${getShiftName(forcedShift)}班`);
            }
            if (
                assignedShifts.some((shift) => shift.id === 'normal')
                && forcedShift !== 'normal'
                && !hasLockedAssignment(person.id, dateKey, 'normal')
            ) {
                violations.push(`${person.name} ${dateKey} 常班既非强制也非手动固定`);
            }
            if (rule.allow.has('all') && !assignedShifts.length) {
                violations.push(`${person.name} ${dateKey} 指定上班但未安排`);
            }
            const requiredShifts = [...rule.allow].filter((shiftId) => shiftId !== 'all');
            if (
                requiredShifts.length
                && !assignedShifts.some((shift) => requiredShifts.includes(shift.id))
            ) {
                violations.push(`${person.name} ${dateKey} 未安排指定班次 ${requiredShifts.join('、')}`);
            }
            if (assignedShifts.length > 1) {
                violations.push(`${person.name} ${dateKey} 同时被安排多个班次`);
            }

            consecutiveDays = assignedShifts.length ? consecutiveDays + 1 : 0;
            if (consecutiveDays > schedulePolicy.maximumConsecutiveDays) {
                violations.push(`${person.name} 截至 ${dateKey} 连续工作超过 ${schedulePolicy.maximumConsecutiveDays} 天`);
            }

            if (
                assignments[dateKey]?.night?.includes(person.id)
                && index < dates.length - 1
                && assignments[dates[index + 1].key]?.morning?.includes(person.id)
            ) {
                violations.push(`${person.name} ${dateKey} 晚班后次日被安排早班`);
            }
            if (
                assignments[dateKey]?.morning?.includes(person.id)
                && index < dates.length - 1
                && assignments[dates[index + 1].key]?.night?.includes(person.id)
            ) {
                violations.push(`${person.name} ${dateKey} 早班后次日被安排晚班`);
            }
        }
    });
    dates.forEach((date) => {
        const config = getDateConfig(date.key);
        const assigned = shifts.reduce(
            (total, shift) => total + (assignments[date.key]?.[shift.id]?.length || 0),
            0,
        );
        const morning = assignments[date.key]?.morning?.length || 0;
        const night = assignments[date.key]?.night?.length || 0;
        if (assigned < config.required) {
            violations.push(`${date.key} 在岗人数不足 ${config.required - assigned} 人`);
        }
        if (morning < config.minimumMorning) {
            violations.push(`${date.key} 早班人数不足 ${config.minimumMorning - morning} 人`);
        }
        if (night < config.minimumNight) {
            violations.push(`${date.key} 晚班人数不足 ${config.minimumNight - night} 人`);
        }
    });
    collectLockedAssignments().forEach((item) => {
        if (!assignments[item.dateKey]?.[item.shiftId]?.includes(item.personId)) {
            violations.push(`${personName(item.personId)} ${item.dateKey} 的固定${getShiftName(item.shiftId)}班缺失`);
        }
    });
    return [...new Set(violations)];
}

function validateHardConstraints(assignments) {
    return getHardConstraintViolations(assignments).length === 0;
}

function getSoftConstraintViolations(assignments) {
    const violations = [];
    state.people.forEach((person) => {
        const targets = getPersonWorkloadTargets(person.id);
        const attendanceDays = getWorkDays(assignments, person.id) + targets.paidLeaveDays;
        const attendanceDifference = attendanceDays - targets.targetAttendanceDays;
        if (attendanceDifference !== 0) {
            violations.push(
                `${person.name} 距离满勤目标${attendanceDifference > 0 ? '多' : '少'} ${Math.abs(attendanceDifference)} 天`
            );
        }

        if (!getForcedShift(person.id)) {
            const preference = getShiftPreference(person.id);
            const counts = getPersonShiftCounts(assignments, person.id);
            if (
                (preference === 'morning' && counts.night > counts.morning)
                || (preference === 'night' && counts.morning > counts.night)
                || (preference === 'balanced' && Math.abs(counts.morning - counts.night) > 2)
            ) {
                violations.push(`${person.name} 班次偏好未充分满足`);
            }
        }
        const workSegments = getWorkSegments(assignments, person.id);
        const isolatedDays = workSegments
            .filter((segment) => segment.length === 1 && segment.hasRestBefore && segment.restAfter > 0)
            .length;
        if (isolatedDays) {
            violations.push(`${person.name} 存在 ${isolatedDays} 个孤立上班日`);
        }
        const sixDaySegments = workSegments.filter((segment) => segment.length === 6).length;
        if (sixDaySegments) {
            violations.push(`${person.name} 存在 ${sixDaySegments} 个连续工作 6 天的工作段`);
        }
        getPureRestSegments(assignments, person.id).forEach((segment) => {
            if (segment.length > schedulePolicy.maximumPreferredPureRestDays) {
                violations.push(
                    `${person.name} ${segment.startDateKey} 至 ${segment.endDateKey} 连续纯排休 ${segment.length} 天`
                );
            } else if (segment.length > 1 && (segment.touchesStart || segment.touchesEnd)) {
                const boundary = segment.touchesStart && segment.touchesEnd
                    ? '周期首尾'
                    : segment.touchesStart ? '周期开始' : '周期结束';
                violations.push(`${person.name} ${boundary}连续纯排休 ${segment.length} 天`);
            }
        });
    });
    dates.forEach((date) => {
        const morning = assignments[date.key]?.morning?.length || 0;
        const night = assignments[date.key]?.night?.length || 0;
        const allowedDifference = getAllowedDailyShiftDifference(date.key);
        const difference = Math.abs(morning - night);
        if (difference > allowedDifference) {
            violations.push(
                `${date.key} 早晚班人数相差 ${difference} 人，超过建议差值 ${allowedDifference} 人`
            );
        }
    });
    return violations;
}

function pickCandidate(assignments, dateKey, shiftId, seed) {
    const people = shuffle([...state.people], seed + dateKey.charCodeAt(dateKey.length - 1) + shiftId.length);
    const validPeople = people
        .filter((person) => canAssign(assignments, person.id, dateKey, shiftId))
        .map((person) => {
            const load = getWorkDays(assignments, person.id);
            const targets = getPersonWorkloadTargets(person.id);
            return {
                person,
                deficit: Math.max(0, targets.targetWorkDays - load),
                preferenceCost: getCandidatePreferenceCost(assignments, person.id, dateKey, shiftId),
                continuityCost: getWorkContinuityCost(assignments, person.id, dateKey),
                load,
                recent: getRecentWorkDays(assignments, person.id, dateKey),
            };
        })
        .map((candidate) => ({
            ...candidate,
            rankingCost: candidate.continuityCost
                + (candidate.preferenceCost * 2)
                + (candidate.recent * 0.5)
                + (candidate.load * 0.25)
                - (candidate.deficit * 1.5),
        }))
        .sort((a, b) => a.rankingCost - b.rankingCost);
    return validPeople[0]?.person || null;
}

function getWorkContinuityCost(assignments, personId, dateKey) {
    const beforeSegmentScore = getPersonWorkSegmentScore(assignments, personId);
    const beforePureRestPenalty = getPureRestPenalty(assignments, personId);
    assignments[dateKey] ||= {};
    assignments[dateKey].morning ||= [];
    assignments[dateKey].morning.push(personId);
    const afterSegmentScore = getPersonWorkSegmentScore(assignments, personId);
    const afterPureRestPenalty = getPureRestPenalty(assignments, personId);
    assignments[dateKey].morning.pop();
    const segmentCost = beforeSegmentScore - afterSegmentScore;
    const pureRestCost = afterPureRestPenalty - beforePureRestPenalty;
    const cappedPureRestCost = Math.max(
        -schedulePolicy.candidatePureRestBenefitCap,
        Math.min(schedulePolicy.candidatePureRestBenefitCap, pureRestCost),
    );
    return segmentCost + cappedPureRestCost;
}

function getAllowedDailyShiftDifference(dateKey) {
    if (!dateKey) {
        return 1;
    }
    const config = getDateConfig(dateKey);
    return Math.max(1, Math.abs(config.minimumMorning - config.minimumNight));
}

function getDailyShiftBalancePenalty(dateKey, morning, night) {
    const excess = Math.max(
        0,
        Math.abs(morning - night) - getAllowedDailyShiftDifference(dateKey),
    );
    return schedulePolicy.dailyShiftImbalancePenalty * (excess ** 2);
}

function getProjectedDailyShiftBalanceCost(assignments, dateKey, shiftId) {
    if (shiftId !== 'morning' && shiftId !== 'night') {
        return 0;
    }
    const morning = assignments[dateKey]?.morning?.length || 0;
    const night = assignments[dateKey]?.night?.length || 0;
    const beforePenalty = getDailyShiftBalancePenalty(dateKey, morning, night);
    const afterPenalty = getDailyShiftBalancePenalty(
        dateKey,
        morning + Number(shiftId === 'morning'),
        night + Number(shiftId === 'night'),
    );
    return afterPenalty - beforePenalty;
}

function getCandidatePreferenceCost(assignments, personId, dateKey, shiftId) {
    if (getForcedShift(personId)) {
        return 0;
    }
    const preference = getShiftPreference(personId);
    if (preference === 'morning') {
        return shiftId === 'morning' ? 0 : shiftId === 'normal' ? 1 : 3;
    }
    if (preference === 'night') {
        return shiftId === 'night' ? 0 : shiftId === 'normal' ? 1 : 3;
    }
    if (shiftId === 'normal') {
        return 2;
    }

    const counts = getPersonShiftCounts(assignments, personId);
    const projectedMorning = counts.morning + (shiftId === 'morning' ? 1 : 0);
    const projectedNight = counts.night + (shiftId === 'night' ? 1 : 0);
    return Math.abs(projectedMorning - projectedNight)
        + getAdjacentShiftSwitchCost(assignments, personId, dateKey, shiftId);
}

function getAdjacentShiftSwitchCost(assignments, personId, dateKey, shiftId) {
    if (shiftId !== 'morning' && shiftId !== 'night') {
        return 0;
    }
    const index = dates.findIndex((date) => date.key === dateKey);
    const oppositeShift = shiftId === 'morning' ? 'night' : 'morning';
    const previousKey = dates[index - 1]?.key;
    const nextKey = dates[index + 1]?.key;
    return Number(Boolean(previousKey && assignments[previousKey]?.[oppositeShift]?.includes(personId)))
        + Number(Boolean(nextKey && assignments[nextKey]?.[oppositeShift]?.includes(personId)));
}

function canAssign(assignments, personId, dateKey, shiftId) {
    if (getWorkDays(assignments, personId) >= getPersonWorkloadTargets(personId).maximumWorkDays) {
        return false;
    }
    if (!canUseShiftByRule(personId, dateKey, shiftId)) {
        return false;
    }
    if (shiftId === 'normal' && getForcedShift(personId) !== 'normal') {
        return false;
    }
    if (shifts.some((shift) => assignments[dateKey]?.[shift.id]?.includes(personId))) {
        return false;
    }
    if (shiftId === 'morning' || shiftId === 'night') {
        const oppositeShift = shiftId === 'morning' ? 'night' : 'morning';
        if (
            hadShiftPreviousDay(assignments, personId, dateKey, oppositeShift)
            || hasShiftNextDay(assignments, personId, dateKey, oppositeShift)
        ) {
            return false;
        }
    }
    if (wouldExceedSixConsecutive(assignments, personId, dateKey)) {
        return false;
    }
    return true;
}

function hadShiftPreviousDay(assignments, personId, dateKey, shiftId) {
    const index = dates.findIndex((date) => date.key === dateKey);
    if (index <= 0) {
        return false;
    }
    const prevKey = dates[index - 1].key;
    return assignments[prevKey]?.[shiftId]?.includes(personId);
}

function hasShiftNextDay(assignments, personId, dateKey, shiftId) {
    const index = dates.findIndex((date) => date.key === dateKey);
    if (index < 0 || index >= dates.length - 1) {
        return false;
    }
    const nextKey = dates[index + 1].key;
    return assignments[nextKey]?.[shiftId]?.includes(personId);
}

function wouldExceedSixConsecutive(assignments, personId, dateKey) {
    const index = dates.findIndex((date) => date.key === dateKey);
    let count = 1;
    for (let i = index - 1; i >= 0; i -= 1) {
        if (isWorking(assignments, personId, dates[i].key)) count += 1;
        else break;
    }
    for (let i = index + 1; i < dates.length; i += 1) {
        if (isWorking(assignments, personId, dates[i].key)) count += 1;
        else break;
    }
    return count > schedulePolicy.maximumConsecutiveDays;
}

function isWorking(assignments, personId, dateKey) {
    return shifts.some((shift) => assignments[dateKey]?.[shift.id]?.includes(personId));
}

function isPureRestDay(assignments, personId, dateKey) {
    return !isWorking(assignments, personId, dateKey)
        && !Boolean(state.rules[personId]?.[dateKey]?.vacation);
}

function getWorkDays(assignments, personId) {
    return dates.filter((date) => isWorking(assignments, personId, date.key)).length;
}

function getRecentWorkDays(assignments, personId, dateKey) {
    const index = dates.findIndex((date) => date.key === dateKey);
    return dates.slice(Math.max(0, index - 6), index).filter((date) => isWorking(assignments, personId, date.key)).length;
}

function getPersonShiftCounts(assignments, personId) {
    return shifts.reduce((counts, shift) => {
        counts[shift.id] = dates.filter((date) =>
            assignments[date.key]?.[shift.id]?.includes(personId)
        ).length;
        return counts;
    }, { morning: 0, normal: 0, night: 0 });
}

function getWorkSegments(assignments, personId) {
    const segments = [];
    let length = 0;
    let startIndex = -1;
    dates.forEach((date, index) => {
        if (isWorking(assignments, personId, date.key)) {
            if (!length) {
                startIndex = index;
            }
            length += 1;
        } else if (length) {
            let restAfter = 1;
            while (
                index + restAfter < dates.length
                && !isWorking(assignments, personId, dates[index + restAfter].key)
            ) {
                restAfter += 1;
            }
            segments.push({
                length,
                hasRestBefore: startIndex > 0,
                restAfter,
            });
            length = 0;
            startIndex = -1;
        }
    });
    if (length) {
        segments.push({
            length,
            hasRestBefore: startIndex > 0,
            restAfter: 0,
        });
    }
    return segments;
}

function getPureRestSegments(assignments, personId) {
    const segments = [];
    let startIndex = -1;
    dates.forEach((date, index) => {
        if (isPureRestDay(assignments, personId, date.key)) {
            if (startIndex < 0) {
                startIndex = index;
            }
            return;
        }
        if (startIndex >= 0) {
            segments.push(createPureRestSegment(startIndex, index - 1));
            startIndex = -1;
        }
    });
    if (startIndex >= 0) {
        segments.push(createPureRestSegment(startIndex, dates.length - 1));
    }
    return segments;
}

function createPureRestSegment(startIndex, endIndex) {
    return {
        startDateKey: dates[startIndex].key,
        endDateKey: dates[endIndex].key,
        length: endIndex - startIndex + 1,
        touchesStart: startIndex === 0,
        touchesEnd: endIndex === dates.length - 1,
    };
}

function getPureRestPenalty(assignments, personId) {
    return getPureRestSegments(assignments, personId).reduce((penalty, segment) => {
        let segmentPenalty = 0;
        if (segment.length > schedulePolicy.maximumPreferredPureRestDays) {
            const excess = segment.length - schedulePolicy.maximumPreferredPureRestDays;
            segmentPenalty += schedulePolicy.internalPureRestPenalty * (excess ** 2);
        }
        if (segment.length > 1) {
            const boundaryExcess = segment.length - 1;
            if (segment.touchesStart) {
                segmentPenalty += schedulePolicy.boundaryPureRestPenalty * (boundaryExcess ** 2);
            }
            if (segment.touchesEnd) {
                segmentPenalty += schedulePolicy.boundaryPureRestPenalty * (boundaryExcess ** 2);
            }
        }
        return penalty + segmentPenalty;
    }, 0);
}

function getAssignedShiftId(assignments, personId, dateKey) {
    return shifts.find((shift) => assignments[dateKey]?.[shift.id]?.includes(personId))?.id || '';
}

function getWorkSegmentScore(segment) {
    if (segment.length >= 3 && segment.length <= 5) {
        return schedulePolicy.compactWorkSegmentReward;
    }
    if (segment.length === 1 && segment.hasRestBefore && segment.restAfter > 0) {
        return -schedulePolicy.isolatedWorkDayPenalty;
    }
    if (segment.length === 6) {
        return -schedulePolicy.sixDayWorkSegmentPenalty;
    }
    return 0;
}

function getPersonWorkPatternScore(assignments, personId) {
    return getPersonWorkSegmentScore(assignments, personId)
        - getPureRestPenalty(assignments, personId);
}

function getPersonWorkSegmentScore(assignments, personId) {
    return getWorkSegments(assignments, personId)
        .reduce((score, segment) => score + getWorkSegmentScore(segment), 0);
}

function getPersonScheduleScore(assignments, personId, averageLoad) {
    let score = 0;
    const workDays = getWorkDays(assignments, personId);
    const targets = getPersonWorkloadTargets(personId);
    const attendanceDays = workDays + targets.paidLeaveDays;
    score -= Math.abs(attendanceDays - targets.targetAttendanceDays) * 5;

    score += getPersonWorkPatternScore(assignments, personId);

    const counts = getPersonShiftCounts(assignments, personId);
    const shiftDifference = Math.abs(counts.morning - counts.night);
    if (!getForcedShift(personId)) {
        score += shiftDifference <= 2 ? 5 : -3 * (shiftDifference - 2);
        const preference = getShiftPreference(personId);
        if (preference === 'morning') {
            score += (counts.morning * 2) - (counts.night * 4);
        } else if (preference === 'night') {
            score += (counts.night * 2) - (counts.morning * 4);
        } else if (shiftDifference <= 2) {
            score += 5;
        }
    }

    const workedShifts = dates.map((date, index) => ({
        index,
        shiftId: getAssignedShiftId(assignments, personId, date.key),
    })).filter((item) => item.shiftId);
    for (let index = 1; index < workedShifts.length; index += 1) {
        const previous = workedShifts[index - 1];
        const current = workedShifts[index];
        if (current.index - previous.index > 2) continue;
        if (previous.shiftId === current.shiftId) {
            score += 1;
        } else if (
            (previous.shiftId === 'morning' && current.shiftId === 'night')
            || (previous.shiftId === 'night' && current.shiftId === 'morning')
        ) {
            score -= 2;
        }
    }

    score -= Math.abs(workDays - averageLoad);
    return score;
}

function getPersonalScoreStats(assignments) {
    if (!state.people.length) {
        return { scores: [], average: 0, variance: 0 };
    }
    const workLoads = state.people.map((person) => getWorkDays(assignments, person.id));
    const averageLoad = workLoads.reduce((sum, days) => sum + days, 0) / workLoads.length;
    const scores = state.people.map((person) => ({
        personId: person.id,
        name: person.name,
        score: getPersonScheduleScore(assignments, person.id, averageLoad),
    }));
    const average = scores.reduce((sum, item) => sum + item.score, 0) / scores.length;
    const variance = scores.reduce(
        (sum, item) => sum + ((item.score - average) ** 2),
        0,
    ) / scores.length;
    return { scores, average, variance };
}

function scoreSchedule(assignments) {
    const personalStats = getPersonalScoreStats(assignments);
    let score = personalStats.scores.reduce((sum, item) => sum + item.score, 0);

    dates.forEach((date) => {
        const assigned = shifts.reduce(
            (total, shift) => total + (assignments[date.key]?.[shift.id]?.length || 0),
            0,
        );
        const surplus = Math.max(0, assigned - getDateConfig(date.key).required);
        score -= surplus + (surplus ** 2 * 0.25);
        score -= getDailyShiftBalancePenalty(
            date.key,
            assignments[date.key]?.morning?.length || 0,
            assignments[date.key]?.night?.length || 0,
        );
    });

    return score - (Math.sqrt(personalStats.variance) * 0.5);
}

function cloneLockedAssignments() {
    const assignments = {};
    Object.keys(state.locked).forEach((key) => {
        const [dateKey, shiftId, personId] = key.split('|');
        assignments[dateKey] ||= {};
        assignments[dateKey][shiftId] ||= [];
        assignments[dateKey][shiftId].push(personId);
    });
    return assignments;
}

function cloneAssignments(assignments) {
    const cloned = {};
    Object.keys(assignments).forEach((dateKey) => {
        cloned[dateKey] = {};
        Object.keys(assignments[dateKey]).forEach((shiftId) => {
            cloned[dateKey][shiftId] = [...assignments[dateKey][shiftId]];
        });
    });
    return cloned;
}

function shuffle(items, seed) {
    const result = [...items];
    let value = seed || 1;
    for (let i = result.length - 1; i > 0; i -= 1) {
        value = (value * 9301 + 49297) % 233280;
        const j = value % (i + 1);
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function serializeRules() {
    const serialized = {};
    Object.entries(state.rules).forEach(([personId, personRules]) => {
        serialized[personId] = {};
        Object.entries(personRules).forEach(([dateKey, rule]) => {
            serialized[personId][dateKey] = {
                allow: [...rule.allow],
                block: [...rule.block],
                vacation: Boolean(rule.vacation),
            };
        });
    });
    return serialized;
}

function createArchiveData() {
    return {
        schemaVersion: '1.2.0',
        archiveType: 'duty-schedule',
        exportedAt: new Date().toISOString(),
        app: {
            name: '带班首页',
            module: '自动排班',
        },
        period: {
            start: dates[0]?.key || '',
            end: dates[dates.length - 1]?.key || '',
            dates: dates.map((date) => date.key),
        },
        settings: {
            shifts: shifts.map((shift) => ({ ...shift })),
            attendance: {
                workdayDefinition: 'monday-to-friday',
                hoursPerDay: schedulePolicy.hoursPerDay,
                paidVacationCountsAsAttendance: true,
                maximumExtraDays: schedulePolicy.maximumExtraDays,
            },
            staffing: {
                baseTotal: state.staffing.baseTotal,
                baseMorning: state.staffing.baseMorning,
                baseNight: state.staffing.baseNight,
                strategies: state.staffing.strategies.map((strategy) => ({
                    ...strategy,
                    dates: [...strategy.dates],
                    weekdays: [...strategy.weekdays],
                })),
            },
            optimization: {
                rewardScore: {
                    workSegment3To5: schedulePolicy.compactWorkSegmentReward,
                    workSegment2: 0,
                    isolatedWorkDay: -schedulePolicy.isolatedWorkDayPenalty,
                    workSegment6: -schedulePolicy.sixDayWorkSegmentPenalty,
                    balancedMorningNight: 5,
                    preferredShift: 2,
                    oppositeShift: -4,
                    sameAdjacentShift: 1,
                    directMorningNightSwitch: 'hard_constraint',
                    internalPureRestPenalty: '-12 * (length - 2)^2',
                    boundaryPureRestPenalty: '-10 * (length - 1)^2',
                    dailyShiftImbalancePenalty: '-16 * excess_difference^2',
                    attendanceTargetDifferencePerDay: -5,
                },
                personalScoreStandardDeviationWeight: 0.5,
                scoreMode: 'reward-rules-v10-strong-segments-balanced-shifts',
                aiSolutionCount: AI_SOLUTION_COUNT,
            },
        },
        diagnostics: state.diagnostics.lastSolve
            ? { lastSolve: JSON.parse(JSON.stringify(state.diagnostics.lastSolve)) }
            : {},
        extensions: JSON.parse(JSON.stringify(archiveExtensions)),
        ui: {
            viewMode: state.viewMode,
            selectedPersonId: state.selectedPersonId,
            openPersonId: state.openPersonId,
            preferenceShifts: { ...state.preferenceShifts },
            preferenceModes: { ...state.preferenceModes },
        },
        people: state.people.map((person) => ({ ...person })),
        shiftPreferences: { ...state.shiftPreferences },
        forcedShifts: {
            choices: { ...state.forcedShiftChoices },
            enabled: { ...state.forcedShiftEnabled },
        },
        preferences: serializeRules(),
        schedule: {
            assignments: cloneAssignments(state.assignments),
            locked: Object.keys(state.locked).filter((key) => state.locked[key]).map((key) => {
                const [dateKey, shiftId, personId] = key.split('|');
                return {
                    dateKey,
                    shiftId,
                    personId,
                    origin: state.lockOrigins[key] === 'calendar' ? 'calendar' : 'preference',
                };
            }),
            solutions: state.solutions.map((solution) => ({
                assignments: cloneAssignments(solution.assignments),
                filled: solution.filled,
                score: solution.score,
                personalScoreAverage: solution.personalScoreAverage,
                personalScoreVariance: solution.personalScoreVariance,
                personalScores: (solution.personalScores || []).map((item) => ({ ...item })),
                minAttendanceDays: solution.minAttendanceDays,
                maxAttendanceDays: solution.maxAttendanceDays,
                minExtraDays: solution.minExtraDays,
                maxExtraDays: solution.maxExtraDays,
                softViolations: [...(solution.softViolations || [])],
                source: solution.source === 'ai' ? 'ai' : 'local',
                name: sanitizeText(solution.name || '').slice(0, 80),
                summary: sanitizeText(solution.summary || '').slice(0, 300),
            })),
            activeSolutionIndex: state.activeSolutionIndex,
        },
    };
}

function formatArchiveTimestamp(date = new Date()) {
    return [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, '0'),
        String(date.getDate()).padStart(2, '0'),
        String(date.getHours()).padStart(2, '0'),
        String(date.getMinutes()).padStart(2, '0'),
        String(date.getSeconds()).padStart(2, '0'),
    ].join('');
}

function exportArchive() {
    const content = JSON.stringify(createArchiveData(), null, 2);
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${formatArchiveTimestamp()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showToast('存档已导出');
}

function buildDateFromKey(dateKey) {
    const [year, month, day] = dateKey.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)
        || !Number.isInteger(year)
        || !Number.isInteger(month)
        || !Number.isInteger(day)
        || Number.isNaN(date.getTime())
        || date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
    ) {
        throw new Error(`无效日期：${dateKey}`);
    }
    return {
        key: dateKey,
        label: `${month}/${day}`,
        full: `${year}年${month}月${day}日`,
        dayIndex: date.getDay(),
        weekday: ['日', '一', '二', '三', '四', '五', '六'][date.getDay()],
    };
}

function sanitizeAssignments(source, validPeople, validDates) {
    const result = {};
    for (const dateKey of validDates) {
        const sourceDate = source?.[dateKey];
        const targetDate = {};
        for (const shift of shifts) {
            const values = sourceDate?.[shift.id];
            if (!Array.isArray(values) || !values.length) {
                targetDate[shift.id] = [];
                continue;
            }
            const seen = new Set();
            const people = [];
            for (const personId of values) {
                if (validPeople.has(personId) && !seen.has(personId)) {
                    seen.add(personId);
                    people.push(personId);
                }
            }
            targetDate[shift.id] = people;
        }
        result[dateKey] = targetDate;
    }
    return result;
}

function sanitizeStaffingConfig(source, validDates) {
    if (!source || typeof source !== 'object') {
        return createDefaultStaffing();
    }
    const validDateSet = new Set(validDates);
    const baseTotal = normalizeStaffingNumber(
        source?.baseTotal ?? source?.required,
        schedulePolicy.weekdayMinimum,
    );
    const baseMorning = normalizeStaffingNumber(
        source?.baseMorning ?? source?.minimumMorning,
        schedulePolicy.minimumMorning,
    );
    const baseNight = normalizeStaffingNumber(
        source?.baseNight ?? source?.minimumNight,
        schedulePolicy.minimumNight,
    );
    const sourceStrategies = (Array.isArray(source?.strategies) ? source.strategies : []).slice(0, 100);
    const usesLegacyDeltas = sourceStrategies.some((strategy) =>
        Object.hasOwn(strategy || {}, 'morningDelta')
        || Object.hasOwn(strategy || {}, 'nightDelta')
    ) && !sourceStrategies.some((strategy) =>
        Object.hasOwn(strategy || {}, 'total')
        || Object.hasOwn(strategy || {}, 'morning')
        || Object.hasOwn(strategy || {}, 'night')
    );

    if (usesLegacyDeltas || !Object.hasOwn(source, 'baseTotal')) {
        const groups = new Map();
        validDates.forEach((dateKey) => {
            const date = buildDateFromKey(dateKey);
            const isWeekend = date.dayIndex === 0 || date.dayIndex === 6;
            const isSpecial = schedulePolicy.specialWeekdays.includes(date.dayIndex);
            let total = isSpecial
                ? schedulePolicy.specialMinimum
                : isWeekend
                    ? schedulePolicy.weekendMinimum
                    : schedulePolicy.weekdayMinimum;
            let morning = baseMorning;
            let night = baseNight;
            sourceStrategies.forEach((strategy) => {
                const matches = strategy?.enabled !== false && (
                    strategy?.type === 'weekday'
                        ? (Array.isArray(strategy.weekdays) ? strategy.weekdays.map(Number) : []).includes(date.dayIndex)
                        : (Array.isArray(strategy?.dates) ? strategy.dates.map(String) : []).includes(dateKey)
                );
                if (matches) {
                    const morningDelta = normalizeStaffingNumber(strategy?.morningDelta, 0);
                    const nightDelta = normalizeStaffingNumber(strategy?.nightDelta, 0);
                    morning += morningDelta;
                    night += nightDelta;
                    total += morningDelta + nightDelta;
                }
            });
            total = Math.max(total, morning + night);
            const key = `${total}|${morning}|${night}`;
            const group = groups.get(key) || { total, morning, night, dates: [] };
            group.dates.push(dateKey);
            groups.set(key, group);
        });
        return {
            baseTotal: schedulePolicy.weekdayMinimum,
            baseMorning,
            baseNight,
            strategies: [...groups.values()].map((group, index) => ({
                id: `legacy-staff-${index + 1}`,
                name: `旧版人力配置 ${index + 1}`,
                type: 'dates',
                dates: group.dates,
                weekdays: [],
                total: group.total,
                morning: group.morning,
                night: group.night,
                enabled: true,
            })),
        };
    }

    const sanitizeOptionalNumber = (value) => {
        if (value === null || value === undefined || value === '') {
            return null;
        }
        return normalizeStaffingNumber(value, null);
    };
    const strategies = sourceStrategies
        .slice(0, 100)
        .map((strategy, index) => {
            const type = strategy?.type === 'weekday' ? 'weekday' : 'dates';
            const datesForStrategy = type === 'dates'
                ? [...new Set((Array.isArray(strategy?.dates) ? strategy.dates : [])
                    .map(String)
                    .filter((dateKey) => validDateSet.has(dateKey)))]
                : [];
            const weekdays = type === 'weekday'
                ? [...new Set((Array.isArray(strategy?.weekdays) ? strategy.weekdays : [])
                    .map(Number)
                    .filter((dayIndex) => Number.isInteger(dayIndex) && dayIndex >= 0 && dayIndex <= 6))]
                : [];
            return {
                id: /^[A-Za-z0-9_-]{1,80}$/.test(String(strategy?.id || ''))
                    ? String(strategy.id)
                    : `imported-staff-${index + 1}`,
                name: sanitizeText(strategy?.name || `人力策略 ${index + 1}`).slice(0, 80),
                type,
                dates: datesForStrategy,
                weekdays,
                total: sanitizeOptionalNumber(strategy?.total),
                morning: sanitizeOptionalNumber(strategy?.morning),
                night: sanitizeOptionalNumber(strategy?.night),
                enabled: strategy?.enabled !== false,
            };
        })
        .filter((strategy) =>
            (strategy.dates.length || strategy.weekdays.length)
            && [strategy.total, strategy.morning, strategy.night].some((value) => value !== null)
        );
    const normalizedStrategies = [];
    strategies.forEach((strategy) => {
        normalizedStrategies.forEach((existing) => {
            if (existing.type !== strategy.type) {
                return;
            }
            if (strategy.type === 'weekday') {
                existing.weekdays = existing.weekdays.filter((dayIndex) => !strategy.weekdays.includes(dayIndex));
            } else {
                existing.dates = existing.dates.filter((dateKey) => !strategy.dates.includes(dateKey));
            }
        });
        for (let index = normalizedStrategies.length - 1; index >= 0; index -= 1) {
            if (!normalizedStrategies[index].dates.length && !normalizedStrategies[index].weekdays.length) {
                normalizedStrategies.splice(index, 1);
            }
        }
        normalizedStrategies.push(strategy);
    });
    return { baseTotal, baseMorning, baseNight, strategies: normalizedStrategies };
}

function parseArchiveData(archive) {
    if (!archive || archive.archiveType !== 'duty-schedule') {
        throw new Error('不是有效的自动排班存档');
    }
    if (typeof archive.schemaVersion !== 'string' || !archive.schemaVersion.startsWith('1.')) {
        throw new Error(`暂不支持存档版本：${archive.schemaVersion || '未知'}`);
    }
    if (!Array.isArray(archive.people) || !archive.people.length) {
        throw new Error('存档中缺少人员数据');
    }
    if (!Array.isArray(archive.period?.dates) || !archive.period.dates.length) {
        throw new Error('存档中缺少排班周期');
    }
    if (archive.people.length > MAX_ARCHIVE_PEOPLE) {
        throw new Error(`存档人员超过 ${MAX_ARCHIVE_PEOPLE} 人，无法安全导入`);
    }
    if (archive.period.dates.length > MAX_ARCHIVE_DATES) {
        throw new Error(`存档日期超过 ${MAX_ARCHIVE_DATES} 天，无法安全导入`);
    }

    const people = archive.people.map((person) => ({
        id: String(person.id || '').trim(),
        name: String(person.name || '').trim(),
    }));
    if (people.some((person) => !person.id || !person.name)) {
        throw new Error('存档中的人员信息不完整');
    }
    if (people.some((person) => !/^[A-Za-z0-9_-]{1,64}$/.test(person.id))) {
        throw new Error('存档中存在不安全的人员 ID');
    }
    if (people.some((person) => person.name.length > 100 || /[<>]/.test(person.name))) {
        throw new Error('存档中存在不安全的人员姓名');
    }
    const validPeople = new Set(people.map((person) => person.id));
    if (validPeople.size !== people.length) {
        throw new Error('存档中存在重复人员 ID');
    }

    const dateKeys = [...new Set(archive.period.dates.map(String))];
    const importedDates = dateKeys.map(buildDateFromKey);
    const validDates = new Set(dateKeys);
    const staffing = sanitizeStaffingConfig(archive.settings?.staffing, dateKeys);
    const rules = {};
    Object.entries(archive.preferences || {}).forEach(([personId, personRules]) => {
        if (!validPeople.has(personId)) {
            return;
        }
        rules[personId] = {};
        Object.entries(personRules || {}).forEach(([dateKey, rule]) => {
            if (!validDates.has(dateKey)) {
                return;
            }
            rules[personId][dateKey] = {
                allow: new Set(Array.isArray(rule.allow) ? rule.allow.filter(isValidPreferenceShift) : []),
                block: new Set(Array.isArray(rule.block) ? rule.block.filter(isValidPreferenceShift) : []),
                vacation: Boolean(rule.vacation),
            };
        });
    });

    const assignments = sanitizeAssignments(
        archive.schedule?.assignments,
        validPeople,
        dateKeys,
    );
    const locked = {};
    const lockOrigins = {};
    (Array.isArray(archive.schedule?.locked) ? archive.schedule.locked : []).forEach((item) => {
        if (
            validPeople.has(item.personId)
            && validDates.has(item.dateKey)
            && shifts.some((shift) => shift.id === item.shiftId)
            && assignments[item.dateKey]?.[item.shiftId]?.includes(item.personId)
        ) {
            const key = assignmentKey(item.dateKey, item.shiftId, item.personId);
            locked[key] = true;
            lockOrigins[key] = item.origin === 'calendar' ? 'calendar' : 'preference';
        }
    });

    const solutions = (Array.isArray(archive.schedule?.solutions) ? archive.schedule.solutions : [])
        .slice(0, 10)
        .map((solution) => ({
            assignments: sanitizeAssignments(solution.assignments, validPeople, dateKeys),
            filled: Number(solution.filled) || 0,
            score: Number(solution.score) || 0,
            personalScoreAverage: Number(solution.personalScoreAverage) || 0,
            personalScoreVariance: Math.max(0, Number(solution.personalScoreVariance) || 0),
            personalScores: Array.isArray(solution.personalScores)
                ? solution.personalScores.slice(0, people.length).map((item) => ({
                    personId: validPeople.has(item?.personId) ? item.personId : '',
                    name: sanitizeText(item?.name || '').slice(0, 100),
                    score: Number(item?.score) || 0,
                })).filter((item) => item.personId)
                : [],
            minAttendanceDays: Number(solution.minAttendanceDays ?? solution.minCombinedDays) || 0,
            maxAttendanceDays: Number(solution.maxAttendanceDays ?? solution.maxCombinedDays) || 0,
            minExtraDays: Number(solution.minExtraDays) || 0,
            maxExtraDays: Number(solution.maxExtraDays) || 0,
            softViolations: Array.isArray(solution.softViolations)
                ? solution.softViolations.slice(0, 200).map((item) => sanitizeText(item).slice(0, 300))
                : [],
            source: solution.source === 'ai' ? 'ai' : 'local',
            name: sanitizeText(solution.name || '').slice(0, 80),
            summary: sanitizeText(solution.summary || '').slice(0, 300),
        }));

    const preferenceShifts = {};
    const preferenceModes = {};
    const shiftPreferences = {};
    const forcedShiftChoices = {};
    const forcedShiftEnabled = {};
    people.forEach((person) => {
        const shiftId = archive.ui?.preferenceShifts?.[person.id];
        const mode = archive.ui?.preferenceModes?.[person.id];
        const shiftPreference = archive.shiftPreferences?.[person.id];
        if (isValidPreferenceShift(shiftId)) {
            preferenceShifts[person.id] = shiftId;
        }
        if (mode === 'work' || mode === 'block') {
            preferenceModes[person.id] = mode;
        }
        if (isValidShiftPreference(shiftPreference)) {
            shiftPreferences[person.id] = shiftPreference;
        }
        const forcedChoice = archive.forcedShifts?.choices?.[person.id];
        if (shifts.some((shift) => shift.id === forcedChoice)) {
            forcedShiftChoices[person.id] = forcedChoice;
            forcedShiftEnabled[person.id] = archive.forcedShifts?.enabled?.[person.id] === true;
        }
    });

    return {
        dates: importedDates,
        people,
        rules,
        staffing,
        assignments,
        locked,
        lockOrigins,
        solutions,
        activeSolutionIndex: Number.isInteger(archive.schedule?.activeSolutionIndex)
            ? archive.schedule.activeSolutionIndex
            : -1,
        viewMode: archive.ui?.viewMode === 'person' ? 'person' : 'shift',
        selectedPersonId: validPeople.has(archive.ui?.selectedPersonId)
            ? archive.ui.selectedPersonId
            : people[0].id,
        openPersonId: validPeople.has(archive.ui?.openPersonId) ? archive.ui.openPersonId : '',
        preferenceShifts,
        preferenceModes,
        shiftPreferences,
        forcedShiftChoices,
        forcedShiftEnabled,
        diagnostics: archive.diagnostics?.lastSolve
            ? {
                lastSolve: {
                    blocking: Array.isArray(archive.diagnostics.lastSolve.blocking)
                        ? archive.diagnostics.lastSolve.blocking.slice(0, 200).map(sanitizeText)
                        : [],
                    warnings: Array.isArray(archive.diagnostics.lastSolve.warnings)
                        ? archive.diagnostics.lastSolve.warnings.slice(0, 200).map(sanitizeText)
                        : [],
                },
            }
            : { lastSolve: null },
        extensions: archive.extensions && typeof archive.extensions === 'object'
            ? archive.extensions
            : {},
    };
}

function isValidPreferenceShift(shiftId) {
    return shiftId === 'all' || shiftId === 'rest' || shifts.some((shift) => shift.id === shiftId);
}

function isValidShiftPreference(preference) {
    return preference === 'morning' || preference === 'night' || preference === 'balanced';
}

function yieldToMainThread() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function parseArchiveJson(text) {
    if (typeof Worker !== 'function') {
        return Promise.resolve(JSON.parse(text));
    }
    return new Promise((resolve, reject) => {
        const workerSource = `
            self.onmessage = function (event) {
                try {
                    self.postMessage({ ok: true, value: JSON.parse(event.data) });
                } catch (error) {
                    self.postMessage({ ok: false, message: error.message });
                }
            };
        `;
        const workerUrl = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
        const worker = new Worker(workerUrl);
        const dispose = () => {
            worker.terminate();
            URL.revokeObjectURL(workerUrl);
        };
        worker.onmessage = (event) => {
            const result = event.data || {};
            dispose();
            if (result.ok) {
                resolve(result.value);
            } else {
                reject(new Error(result.message || 'JSON 格式无效'));
            }
        };
        worker.onerror = () => {
            dispose();
            try {
                resolve(JSON.parse(text));
            } catch (error) {
                reject(error);
            }
        };
        worker.postMessage(text);
    });
}

async function importArchiveFile(file) {
    const originalLabel = importArchiveBtn.textContent;
    try {
        if (file.size > MAX_ARCHIVE_FILE_SIZE) {
            throw new Error(`存档超过 ${Math.round(MAX_ARCHIVE_FILE_SIZE / 1024 / 1024)} MB`);
        }
        importArchiveBtn.disabled = true;
        importArchiveBtn.textContent = '正在读取...';
        await yieldToMainThread();
        const text = await file.text();
        importArchiveBtn.textContent = '正在解析...';
        await yieldToMainThread();
        const archive = await parseArchiveJson(text);
        const imported = parseArchiveData(archive);
        importArchiveBtn.textContent = '正在渲染...';
        await yieldToMainThread();
        dates = imported.dates;
        state.people = imported.people;
        state.rules = imported.rules;
        state.staffing = imported.staffing;
        state.assignments = imported.assignments;
        state.locked = imported.locked;
        state.lockOrigins = imported.lockOrigins;
        state.viewMode = imported.viewMode;
        state.selectedPersonId = imported.selectedPersonId;
        state.openPersonId = imported.openPersonId;
        state.preferenceShifts = imported.preferenceShifts;
        state.preferenceModes = imported.preferenceModes;
        state.shiftPreferences = imported.shiftPreferences;
        state.forcedShiftChoices = imported.forcedShiftChoices;
        state.forcedShiftEnabled = imported.forcedShiftEnabled;
        state.people.forEach((person) => migrateFixedAssignmentsToForcedShift(person.id));
        state.solutions = imported.solutions.map((solution) =>
            createSolutionRecord(solution.assignments, {
                source: solution.source,
                name: solution.name,
                summary: solution.summary,
            })
        ).filter((solution) => validateHardConstraints(solution.assignments));
        state.activeSolutionIndex = state.solutions.length
            ? Math.max(-1, Math.min(imported.activeSolutionIndex, state.solutions.length - 1))
            : -1;
        state.diagnostics = imported.diagnostics;
        archiveExtensions = imported.extensions;
        resetStrategyEditor();
        closeAssignmentActionMenu();
        closeManualMenu();
        renderAll();
        showToast('存档已完整导入');
    } catch (error) {
        showToast(`导入失败：${error.message}`);
    } finally {
        importArchiveBtn.disabled = false;
        importArchiveBtn.textContent = originalLabel;
        archiveFileInput.value = '';
    }
}

function syncViewSwitch() {
    document.getElementById('shiftViewBtn').classList.toggle('active', state.viewMode === 'shift');
    document.getElementById('personViewBtn').classList.toggle('active', state.viewMode === 'person');
}

function renderAll() {
    syncViewSwitch();
    renderStaffingControls();
    renderRange();
    renderPeople();
    renderCalendar();
    renderSolutions();
}

function syncOpenPersonCard() {
    syncPreferencePlacement();
    peopleList.querySelectorAll('.person-card').forEach((card) => {
        const isActive = card.dataset.personId === state.openPersonId;
        card.classList.toggle('active', isActive);
        card.querySelectorAll('[data-person-toggle]').forEach((toggle) => {
            toggle.setAttribute('aria-expanded', isActive ? 'true' : 'false');
            if (toggle.classList.contains('expand-toggle')) {
                toggle.classList.toggle('active', isActive);
                toggle.setAttribute('aria-label', isActive ? '收起班次偏好' : '展开班次偏好');
            }
        });
    });
}

function toggleOpenPerson(personId) {
    state.selectedPersonId = personId;
    state.openPersonId = state.openPersonId === personId ? '' : personId;
    syncOpenPersonCard();
}

function closeOpenPerson() {
    if (!state.openPersonId) {
        return;
    }
    state.openPersonId = '';
    syncOpenPersonCard();
}

[
    [baseTotalInput, 'baseTotal', '总人数'],
    [baseMorningInput, 'baseMorning', '早班人数'],
    [baseNightInput, 'baseNight', '晚班人数'],
].forEach(([input, field, label]) => input.addEventListener('change', () => {
    const value = normalizeStaffingNumber(input.value, -1);
    if (value < 0) {
        input.value = state.staffing[field];
        showToast(`${label}必须是非负整数`);
        return;
    }
    state.staffing[field] = value;
    renderStaffingControls();
    invalidateSolutionsForStaffingChange();
}));

strategyTypeSelect.addEventListener('change', syncStrategyEditorType);
strategyTargetPicker.addEventListener('click', (event) => {
    const weekdayButton = event.target.closest('[data-strategy-weekday]');
    const dateButton = event.target.closest('[data-strategy-date]');
    if (weekdayButton) {
        const dayIndex = Number(weekdayButton.dataset.strategyWeekday);
        strategyDraftWeekdays.has(dayIndex)
            ? strategyDraftWeekdays.delete(dayIndex)
            : strategyDraftWeekdays.add(dayIndex);
    } else if (dateButton) {
        const dateKey = dateButton.dataset.strategyDate;
        strategyDraftDates.has(dateKey)
            ? strategyDraftDates.delete(dateKey)
            : strategyDraftDates.add(dateKey);
    } else {
        return;
    }
    renderStrategyTargetPicker();
});
document.getElementById('addStrategyBtn').addEventListener('click', saveStaffingStrategy);
document.getElementById('openStrategyPreviewBtn').addEventListener('click', openStrategyPreview);
document.getElementById('closeStrategyPreviewBtn').addEventListener('click', closeStrategyPreview);
document.getElementById('returnFromStrategyPreviewBtn').addEventListener('click', closeStrategyPreview);
strategyPreviewDialog.addEventListener('click', (event) => {
    if (event.target === strategyPreviewDialog) {
        closeStrategyPreview();
    }
});
cancelStrategyEditBtn.addEventListener('click', resetStrategyEditor);
strategyList.addEventListener('click', (event) => {
    const editButton = event.target.closest('[data-edit-strategy]');
    const toggleButton = event.target.closest('[data-toggle-strategy]');
    const deleteButton = event.target.closest('[data-delete-strategy]');
    if (!editButton && !toggleButton && !deleteButton) {
        return;
    }
    const strategyId = editButton?.dataset.editStrategy
        || toggleButton?.dataset.toggleStrategy
        || deleteButton?.dataset.deleteStrategy;
    const strategy = state.staffing.strategies.find((item) => item.id === strategyId);
    if (!strategy) {
        return;
    }
    if (editButton) {
        editStaffingStrategy(strategyId);
        return;
    }
    if (toggleButton) {
        strategy.enabled = !strategy.enabled;
    } else {
        state.staffing.strategies = state.staffing.strategies.filter((item) => item.id !== strategyId);
        if (editingStrategyId === strategyId) {
            resetStrategyEditor();
        }
    }
    renderStaffingControls();
    invalidateSolutionsForStaffingChange();
});

document.getElementById('shiftViewBtn').addEventListener('click', () => {
    removeFrozenScheduleHeader();
    state.viewMode = 'shift';
    syncViewSwitch();
    renderCalendar();
});

document.getElementById('personViewBtn').addEventListener('click', () => {
    clearSchedulePersonHighlight();
    state.viewMode = 'person';
    syncViewSwitch();
    renderCalendar();
});

document.getElementById('exportScheduleTextBtn').addEventListener('click', exportScheduleText);
document.getElementById('exportArchiveBtn').addEventListener('click', exportArchive);
document.getElementById('importArchiveBtn').addEventListener('click', () => archiveFileInput.click());
archiveFileInput.addEventListener('change', () => {
    const [file] = archiveFileInput.files;
    if (file) {
        importArchiveFile(file);
    }
});

solveBtn.addEventListener('click', solveLocalSchedules);
aiSolveBtn.addEventListener('click', () => {
    if (aiAbortController) {
        stopAiSchedule();
    } else {
        solveAiSchedules();
    }
});
document.getElementById('clearBtn').addEventListener('click', () => {
    stopAiSchedule();
    state.locked = {};
    state.lockOrigins = {};
    clearAssignments(false);
    showToast('已清空排班');
});

document.getElementById('addPersonBtn').addEventListener('click', () => {
    const id = `p${Date.now()}`;
    state.people.push({ id, name: `新同学${state.people.length + 1}` });
    state.selectedPersonId = id;
    state.openPersonId = id;
    renderAll();
});

document.getElementById('removePersonBtn').addEventListener('click', () => {
    if (state.people.length <= 1) {
        showToast('至少保留 1 名人员');
        return;
    }
    const personId = state.selectedPersonId;
    state.people = state.people.filter((person) => person.id !== personId);
    dates.forEach((date) => removePersonFromDate(personId, date.key));
    delete state.rules[personId];
    delete state.preferenceShifts[personId];
    delete state.preferenceModes[personId];
    delete state.shiftPreferences[personId];
    delete state.forcedShiftChoices[personId];
    delete state.forcedShiftEnabled[personId];
    state.selectedPersonId = state.people[0]?.id || '';
    state.openPersonId = '';
    renderAll();
});

peopleList.addEventListener('click', (event) => {
    const target = event.target.closest('button');
    if (!target || !peopleList.contains(target)) {
        return;
    }

    const toggle = target.closest('[data-person-toggle]');
    if (toggle) {
        event.preventDefault();
        event.stopPropagation();
        toggleOpenPerson(toggle.dataset.personToggle);
        return;
    }

    const forceShiftButton = target.closest('[data-force-shift]');
    if (forceShiftButton) {
        event.preventDefault();
        event.stopPropagation();
        const personId = forceShiftButton.dataset.person;
        state.selectedPersonId = personId;
        state.openPersonId = personId;
        state.forcedShiftChoices[personId] = forceShiftButton.dataset.forceShift;
        if (isForcedShiftEnabled(personId)) {
            const currentShift = getPreferenceShift(personId);
            if (getPreferenceMode(personId) === 'work' && shifts.some((shift) => shift.id === currentShift)) {
                state.preferenceShifts[personId] = getForcedShift(personId);
            }
            const migrated = migrateFixedAssignmentsToForcedShift(personId);
            showToast(migrated ? `已迁移 ${migrated} 个手动固定班次` : '强制班次已更新，下次求解时重排普通班次');
        }
        state.solutions = [];
        state.activeSolutionIndex = -1;
        state.diagnostics.lastSolve = analyzeFixedRuleConflicts();
        refreshPeopleAndCalendar();
        renderSolutions();
        return;
    }

    const forceToggleButton = target.closest('[data-force-toggle]');
    if (forceToggleButton) {
        event.preventDefault();
        event.stopPropagation();
        const personId = forceToggleButton.dataset.person;
        state.selectedPersonId = personId;
        state.openPersonId = personId;
        if (!isForcedShiftEnabled(personId) && !getForcedShiftChoice(personId)) {
            showToast('请先选择早班、常班或晚班，再开启强制');
            return;
        }
        state.forcedShiftEnabled[personId] = !isForcedShiftEnabled(personId);
        let migrated = 0;
        if (isForcedShiftEnabled(personId)) {
            const currentShift = getPreferenceShift(personId);
            if (getPreferenceMode(personId) === 'work' && shifts.some((shift) => shift.id === currentShift)) {
                state.preferenceShifts[personId] = getForcedShift(personId);
            }
            migrated = migrateFixedAssignmentsToForcedShift(personId);
        }
        state.solutions = [];
        state.activeSolutionIndex = -1;
        state.diagnostics.lastSolve = analyzeFixedRuleConflicts();
        showToast(isForcedShiftEnabled(personId)
            ? `强制${getShiftName(getForcedShift(personId))}班已开启${migrated ? `，已迁移 ${migrated} 个固定项` : ''}`
            : '强制班次已关闭，现有固定班次保持不变');
        refreshPeopleAndCalendar();
        renderSolutions();
        return;
    }

    const shiftButton = target.closest('[data-pref-shift]');
    if (shiftButton) {
        event.preventDefault();
        event.stopPropagation();
        state.selectedPersonId = shiftButton.dataset.person;
        state.openPersonId = shiftButton.dataset.person;
        state.preferenceShifts[shiftButton.dataset.person] = shiftButton.dataset.prefShift;
        refreshPeopleOnly();
        return;
    }

    const schedulePreferenceButton = target.closest('[data-shift-preference]');
    if (schedulePreferenceButton) {
        event.preventDefault();
        event.stopPropagation();
        const personId = schedulePreferenceButton.dataset.person;
        const preference = schedulePreferenceButton.dataset.shiftPreference;
        if (!isValidShiftPreference(preference)) {
            return;
        }
        state.selectedPersonId = personId;
        state.openPersonId = personId;
        state.shiftPreferences[personId] = preference;
        state.solutions = [];
        state.activeSolutionIndex = -1;
        refreshPeopleOnly();
        renderSolutions();
        return;
    }

    const modeButton = target.closest('[data-pref-mode]');
    if (modeButton) {
        event.preventDefault();
        event.stopPropagation();
        if (getPreferenceShift(modeButton.dataset.person) === 'rest') {
            return;
        }
        state.selectedPersonId = modeButton.dataset.person;
        state.openPersonId = modeButton.dataset.person;
        state.preferenceModes[modeButton.dataset.person] = modeButton.dataset.prefMode;
        if (
            modeButton.dataset.prefMode === 'work'
            && getForcedShift(modeButton.dataset.person)
            && shifts.some((shift) => shift.id === getPreferenceShift(modeButton.dataset.person))
        ) {
            state.preferenceShifts[modeButton.dataset.person] = getForcedShift(modeButton.dataset.person);
        }
        refreshPeopleOnly();
        return;
    }

    const dateButton = target.closest('[data-pref-date]');
    if (dateButton) {
        event.preventDefault();
        event.stopPropagation();
        state.selectedPersonId = dateButton.dataset.person;
        state.openPersonId = dateButton.dataset.person;
        togglePreferenceDate(dateButton.dataset.person, dateButton.dataset.prefDate);
        refreshPeopleAndCalendar();
        return;
    }

});

calendarWrap.addEventListener('click', (event) => {
    if (event.target.closest('button')) {
        return;
    }

    const cell = event.target.closest('td.cell');
    if (!cell || !calendarWrap.contains(cell)) {
        closeManualMenu();
        return;
    }

    event.preventDefault();
    showManualMenu(cell);
});

document.addEventListener('click', (event) => {
    if (!event.target.closest('.manual-menu, td.cell')) {
        closeManualMenu();
    }
    if (!event.target.closest('.assignment-action-menu, [data-lock]')) {
        closeAssignmentActionMenu();
    }
    if (!event.target.closest('[data-lock][data-person]')) {
        clearSchedulePersonHighlight();
    }
    if (!event.target.closest('.person-card')) {
        closeOpenPerson();
    }
});

window.addEventListener('scroll', (event) => {
    scheduleFrozenHeaderSync();
    if (event.target instanceof Element && event.target.closest('.manual-menu')) {
        return;
    }
    closeManualMenu();
    closeAssignmentActionMenu();
}, true);

window.addEventListener('resize', () => {
    syncPreferencePlacement();
    closeManualMenu();
    closeAssignmentActionMenu();
    rebuildFrozenScheduleHeader();
});

calendarWrap.addEventListener('scroll', scheduleFrozenHeaderSync, { passive: true });

syncStrategyEditorType();
configureAiServiceLogin();
renderAll();
