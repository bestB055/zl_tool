const MAX_COLUMNS = 5;
const DEPLOYMENT_CONFIG = window.DAIBAN_HOME_CONFIG || {};
const DOUBAO_SEARCH_API_URL = String(DEPLOYMENT_CONFIG.DOUBAO_SEARCH_API_URL || '').trim();
const DEEPSEEK_PROXY_API_URL = String(DEPLOYMENT_CONFIG.DEEPSEEK_PROXY_API_URL || '').trim();
const CONFIGURED_DOUBAO_SEARCH_API_KEY = normalizeApiKey(DEPLOYMENT_CONFIG.DOUBAO_SEARCH_API_KEY || '');
let columnCount = 2;
let manualKeywords = [];
let modalLines = [];
let acceptedAiKeywords = [];
let activeKeywordRescanMenu = null;
const aiPipelineState = {
    phase: 'idle',
    source: '',
    eventProfile: null,
    searchPlan: null,
    rawSearchResults: [],
    samples: { groupA: [], groupB: [], groupC: [] },
    candidates: [],
    tiers: { high: [], medium: [], low: [] },
    selectedIds: new Set(),
    warnings: [],
    eventDossier: null,
    diagnostics: {
        enrichmentQueries: 0,
        enrichmentSuccesses: 0,
        enrichmentSamples: 0,
        verifiedFacts: 0,
        inferredFacts: 0,
        rawCandidates: 0,
        validCandidates: 0,
        repairedCandidates: 0,
        fallbackCandidates: 0,
        locationTerms: 0,
        behaviorTerms: 0,
        coverageCandidates: 0,
        rejectedCandidates: [],
    },
};

function splitInputTerms(value) {
    // Preserve English commas so "词一,词二" remains one keyword.
    return sanitizeText(value)
        .split(/[、\s\r\n]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function appendNounItem(list, keyword, onRemove) {
    const item = document.createElement('div');
    item.className = 'noun-item';
    const text = document.createElement('span');
    text.className = 'noun-text keyword-chip';
    text.dataset.rescanValue = keyword;
    text.title = '按住 Ctrl 点击可回扫';
    text.textContent = keyword;
    const remove = document.createElement('button');
    remove.className = 'noun-remove';
    remove.type = 'button';
    remove.textContent = '×';
    remove.addEventListener('click', () => {
        item.remove();
        onRemove();
        updateOutput();
    });
    item.append(text, remove);
    list.appendChild(item);
}

function addManualKeyword() {
    const input = document.getElementById('manualKeywordInput');
    const keywords = splitInputTerms(input.value);
    if (!keywords.length) return;
    const list = document.getElementById('manualList');
    keywords.forEach(keyword => {
        if (manualKeywords.includes(keyword)) return;
        manualKeywords.push(keyword);
        appendNounItem(list, keyword, () => {
            const index = manualKeywords.indexOf(keyword);
            if (index >= 0) manualKeywords.splice(index, 1);
        });
    });
    input.value = '';
    input.focus();
    updateOutput();
}

function removeManualKeyword(btn, keyword) {
    btn.parentElement.remove();
    manualKeywords = manualKeywords.filter(k => k !== keyword);
    updateOutput();
}

function updateOutput() {
    const columns = document.querySelectorAll('.column:not(#manualColumn)');
    const nounLists = [];
    columns.forEach(col => {
        const items = col.querySelectorAll('.noun-item');
        const nouns = Array.from(items).map(item => sanitizeText(item.querySelector('.noun-text').textContent).trim()).filter(Boolean);
        if (nouns.length > 0) nounLists.push(nouns);
    });
    let result = [...acceptedAiKeywords, ...manualKeywords];
    if (nounLists.length > 0) {
        const combinations = cartesianProduct(nounLists);
        const combinationStrings = combinations.map(row => row.join(','));
        result = [...result, ...combinationStrings];
    }
    setOutputLines([...new Set(result)]);
}

function addNoun(columnIndex) {
    const input = document.getElementById(`nounInput${columnIndex}`);
    const nouns = splitInputTerms(input.value);
    if (!nouns.length) return;
    const list = document.getElementById(`nounList${columnIndex}`);
    const current = new Set(Array.from(list.querySelectorAll('.noun-text')).map(item => item.textContent));
    nouns.forEach(noun => {
        if (current.has(noun)) return;
        current.add(noun);
        appendNounItem(list, noun, () => {});
    });
    input.value = '';
    input.focus();
    updateOutput();
}

function addKeywordsToColumn(keywords, columnIndex) {
    const list = document.getElementById(`nounList${columnIndex}`);
    if (!list) return 0;
    const current = new Set(Array.from(list.querySelectorAll('.noun-text')).map(item => item.textContent));
    let added = 0;
    keywords.forEach(keyword => {
        if (current.has(keyword)) return;
        current.add(keyword);
        appendNounItem(list, keyword, () => {});
        added += 1;
    });
    updateOutput();
    return added;
}

function addKeywordsToManual(keywords) {
    const list = document.getElementById('manualList');
    let added = 0;
    keywords.forEach(keyword => {
        if (manualKeywords.includes(keyword)) return;
        manualKeywords.push(keyword);
        appendNounItem(list, keyword, () => {
            const index = manualKeywords.indexOf(keyword);
            if (index >= 0) manualKeywords.splice(index, 1);
        });
        added += 1;
    });
    updateOutput();
    return added;
}

function removeNoun(btn) {
    btn.parentElement.remove();
    updateOutput();
}

function addColumn() {
    if (columnCount >= MAX_COLUMNS) return;
    columnCount++;
    const wrapper = document.getElementById('columnsWrapper');
    const column = document.createElement('div');
    column.className = 'column';
    column.dataset.columnIndex = columnCount - 1;
    column.innerHTML = `<div class="column-header"><span class="column-title">第 ${columnCount} 列</span><button class="column-remove" data-remove-column>×</button></div><div class="noun-list" id="nounList${columnCount - 1}"></div><div class="add-noun-input"><input type="text" class="noun-input" id="nounInput${columnCount - 1}" placeholder="输入名词"><button class="add-noun-btn" data-column="${columnCount - 1}">添加</button></div>`;
    wrapper.appendChild(column);
    if (columnCount >= MAX_COLUMNS) document.getElementById('addColumnBtn').disabled = true;
    refreshCandidateTargetColumns();
    if (aiPipelineState.candidates.length) renderKeywordTiers();
}

function removeColumn(btn) {
    btn.parentElement.parentElement.remove();
    columnCount--;
    document.getElementById('addColumnBtn').disabled = false;
    const columns = document.querySelectorAll('.column:not(#manualColumn)');
    columns.forEach((col, index) => {
        col.dataset.columnIndex = index;
        col.querySelector('.column-title').textContent = `第 ${index + 1} 列`;
        col.querySelector('.noun-list').id = `nounList${index}`;
        col.querySelector('.noun-input').id = `nounInput${index}`;
        col.querySelector('.add-noun-btn').dataset.column = index;
    });
    refreshCandidateTargetColumns();
    updateOutput();
    if (aiPipelineState.candidates.length) renderKeywordTiers();
}

function refreshCandidateTargetColumns() {
    const select = document.getElementById('candidateTargetColumn');
    if (!select) return;
    const selected = select.value;
    select.innerHTML = '';
    document.querySelectorAll('.column:not(#manualColumn)').forEach((column, index) => {
        const option = document.createElement('option');
        option.value = column.dataset.columnIndex;
        option.textContent = `加入第 ${index + 1} 列参与组合`;
        select.appendChild(option);
    });
    if ([...select.options].some(option => option.value === selected)) select.value = selected;
}

function cartesianProduct(arrays) {
    return arrays.reduce((acc, arr) => acc.flatMap(a => arr.map(b => [...a, b])), [[]]);
}

function sanitizeText(value) {
    return String(value ?? '').replace(/[\u200B\u200C\u200D\uFEFF\u2060\u180E]/g, '');
}

function normalizeApiKey(value) {
    return sanitizeText(value).trim().replace(/^Bearer\s+/i, '');
}

function updateApiKeyStatus(message = '', isError = false) {
    const status = document.getElementById('aiGeneratorStatus');
    const deepSeekReady = Boolean(DEEPSEEK_PROXY_API_URL);
    const doubaoReady = Boolean(CONFIGURED_DOUBAO_SEARCH_API_KEY);
    status.textContent = message || `环境配置：AI 服务代理 ${deepSeekReady ? '已配置' : '未配置'}；豆包搜索 Key ${doubaoReady ? '已配置' : '未配置'}。`;
    status.classList.toggle('error', isError);
    status.classList.toggle('api-key-saved', !isError && deepSeekReady && doubaoReady);
}

function getDeepSeekAuthUrl() {
    if (!DEEPSEEK_PROXY_API_URL) return '';
    try {
        const url = new URL(DEEPSEEK_PROXY_API_URL);
        url.pathname = '/auth-check';
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return '';
    }
}

function configureAiServiceLogin() {
    const link = document.getElementById('aiServiceLoginLink');
    const authUrl = getDeepSeekAuthUrl();
    if (!link) return;
    if (!authUrl) {
        link.hidden = true;
        link.removeAttribute('href');
        return;
    }
    link.hidden = false;
    link.href = authUrl;
}

async function callDeepSeekJson(operation, stage, input) {
    if (!DEEPSEEK_PROXY_API_URL) {
        throw new Error(`${stage}失败：AI 服务代理未配置`);
    }

    let response;
    try {
        response = await fetch(DEEPSEEK_PROXY_API_URL, {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation, input }),
        });
    } catch {
        throw new Error(`${stage}网络请求失败，请先登录 AI 服务`);
    }

    const contentType = response.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error(`${stage}未获得授权，请先登录 AI 服务`);
    }
    const payload = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
        throw new Error(`${stage}未获得授权，请先登录 AI 服务`);
    }
    if (!response.ok) {
        throw new Error(`${stage}失败：${payload.message || payload.error || `HTTP ${response.status}`}`);
    }
    if (!payload.result || typeof payload.result !== 'object') {
        throw new Error(`${stage}返回结果无效`);
    }
    return payload.result;
}

function normalizeCandidate(candidate, defaultOrigin = 'evidence', rejectionLog = []) {
    let rawWords = candidate;
    let origin = defaultOrigin;
    let reason = '';
    let sourceTerms = [];
    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
        rawWords = candidate.words ?? candidate.terms ?? candidate.text ?? candidate.candidate;
        origin = candidate.origin || defaultOrigin;
        reason = sanitizeText(candidate.reason || '').trim();
        sourceTerms = Array.isArray(candidate.sourceTerms) ? candidate.sourceTerms : [];
    }
    if (!Array.isArray(rawWords) && typeof rawWords !== 'string') {
        rejectionLog.push('格式不可识别');
        return null;
    }
    const splitPattern = /\s*(?:,|，|、|\/|\+|\bAND\b)\s*/i;
    const words = (Array.isArray(rawWords) ? rawWords : rawWords.split(splitPattern))
        .map(word => sanitizeText(word)
            .replace(/^\s*\d+[.)、：:\s-]*/, '')
            .replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim())
        .filter(Boolean);
    if (words.length < 2 || words.length > 3) {
        rejectionLog.push(`词数不符（${words.length}）`);
        return null;
    }
    if (new Set(words.map(normalizeMatchText)).size !== words.length) {
        rejectionLog.push('包含重复词');
        return null;
    }
    const safeOrigin = ['evidence', 'inferred', 'fallback'].includes(origin) ? origin : defaultOrigin;
    return {
        words,
        text: words.join(','),
        origin: safeOrigin,
        reason,
        sourceTerms: sourceTerms.map(sanitizeText).filter(Boolean),
        isInferred: safeOrigin === 'inferred' || Boolean(candidate?.isInferred),
    };
}

function normalizeCandidateList(inputs, defaultOrigin = 'evidence', rejectionLog = []) {
    const unique = new Map();
    (inputs || []).forEach(input => {
        const candidate = normalizeCandidate(input, defaultOrigin, rejectionLog);
        if (!candidate) return;
        const key = candidate.words.map(normalizeMatchText).sort().join('|');
        if (!unique.has(key)) unique.set(key, candidate);
    });
    return [...unique.values()];
}

const GENERIC_TERMS = new Set(['发生', '表示', '有关', '现场', '工作', '开展', '问题', '调查', '人员', '事件', '消息', '影响', '情况', '相关', '中国', '美国']);
const EVENT_TYPE_TERMS = ['火灾', '爆炸', '坍塌', '地震', '洪水', '事故', '通报', '处罚', '逮捕', '失联', '伤亡', '召回', '上市', '发布', '会议', '政策'];

function normalizeTerm(value) {
    const term = sanitizeText(value).replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, '').trim();
    if (!term || term.length > 16 || /^\d+$/.test(term) || GENERIC_TERMS.has(term)) return '';
    return term;
}

function normalizeAxisTerms(items, defaultOrigin = 'evidence') {
    const unique = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
        const rawTerm = item && typeof item === 'object' ? (item.term ?? item.text ?? item.name) : item;
        const term = normalizeTerm(rawTerm);
        if (!term) return;
        const rawOrigin = item && typeof item === 'object' ? item.origin : defaultOrigin;
        const origin = rawOrigin === 'inferred' ? 'inferred' : 'evidence';
        const reason = item && typeof item === 'object' ? sanitizeText(item.reason || '').trim() : '';
        const key = normalizeMatchText(term);
        const current = unique.get(key);
        if (!current || (current.origin === 'inferred' && origin === 'evidence')) {
            unique.set(key, { term, origin, reason });
        }
    });
    return [...unique.values()];
}

// 人工编辑的核心模式是“限定实体轴 × 事件表达轴”，优先生成覆盖式二词组合。
function buildCoverageCandidates(dossier) {
    const allLocations = normalizeAxisTerms(dossier?.locationTerms);
    const shortLocations = allLocations.filter(item => item.term.length <= 6);
    const locations = (shortLocations.length >= 2 ? shortLocations : allLocations).slice(0, 5);
    const behaviors = normalizeAxisTerms(dossier?.behaviorTerms)
        .filter(item => item.term.length <= 8)
        .slice(0, 10);
    const candidates = [];
    locations.forEach(location => {
        behaviors.forEach(behavior => {
            const isInferred = location.origin === 'inferred' || behavior.origin === 'inferred';
            const candidate = normalizeCandidate({
                words: [location.term, behavior.term],
                origin: isInferred ? 'inferred' : 'evidence',
                isInferred,
                reason: `覆盖组合：地点“${location.term}” × 表达“${behavior.term}”`,
                sourceTerms: [location.term, behavior.term],
            }, isInferred ? 'inferred' : 'evidence');
            if (candidate) candidates.push(candidate);
        });
    });
    return {
        locations,
        behaviors,
        candidates: normalizeCandidateList(candidates),
    };
}

function buildFallbackCandidates(source, dossier, plan, existingCandidates = []) {
    const termMap = new Map();
    const addTerms = (items, inferred = false) => (items || []).forEach(item => {
        const term = normalizeTerm(item);
        if (!term) return;
        const key = normalizeMatchText(term);
        const current = termMap.get(key);
        if (!current || (current.inferred && !inferred)) termMap.set(key, { term, inferred });
    });
    addTerms(dossier?.coreEntities);
    addTerms(dossier?.candidateTerms);
    addTerms(plan?.coreEntities);
    addTerms(dossier?.inferredEntities, true);
    EVENT_TYPE_TERMS.filter(term => source.includes(term)).forEach(term => addTerms([term], true));
    // 两个实体只能形成一组无序二词组合，补充显式标记的推断限定词以满足最低三组交付。
    if (termMap.size === 2) addTerms(['官方通报', '最新进展'], true);

    const terms = [...termMap.values()].slice(0, 10);
    const rejectionLog = [];
    const candidates = normalizeCandidateList(existingCandidates, 'evidence', rejectionLog);
    const keys = new Set(candidates.map(item => item.words.map(normalizeMatchText).sort().join('|')));
    const addCandidate = entries => {
        const isInferred = entries.some(entry => entry.inferred);
        const candidate = normalizeCandidate({
            words: entries.map(entry => entry.term),
            origin: 'fallback',
            isInferred,
            reason: isInferred ? '包含合理推断的原子词' : '由结构化实体确定性组合',
            sourceTerms: entries.map(entry => entry.term),
        }, 'fallback', rejectionLog);
        if (!candidate) return;
        const key = candidate.words.map(normalizeMatchText).sort().join('|');
        if (!keys.has(key)) {
            keys.add(key);
            candidates.push(candidate);
        }
    };
    for (let i = 0; i < terms.length && candidates.length < 3; i++) {
        for (let j = i + 1; j < terms.length && candidates.length < 3; j++) addCandidate([terms[i], terms[j]]);
    }
    for (let i = 0; i < terms.length && candidates.length < 3; i++) {
        for (let j = i + 1; j < terms.length && candidates.length < 3; j++) {
            for (let k = j + 1; k < terms.length && candidates.length < 3; k++) addCandidate([terms[i], terms[j], terms[k]]);
        }
    }
    return { candidates, availableTerms: terms.map(item => item.term), rejectionLog };
}

function normalizeQuery(query) {
    return sanitizeText(query).replace(/\s+/g, ' ').trim().slice(0, 100);
}

function prepareSearchPlan(data) {
    // 理想数量：groupA 6、groupB 4、groupC 2；短输入场景下最低要求 2/1/1
    const ideal = { groupA: 6, groupB: 4, groupC: 2 };
    const minimum = { groupA: 2, groupB: 1, groupC: 1 };
    const queries = {};
    Object.entries(ideal).forEach(([group, limit]) => {
        queries[group] = [...new Set(toStringArray(data.queries?.[group], limit).map(normalizeQuery).filter(Boolean))].slice(0, limit);
        if (queries[group].length < minimum[group]) {
            throw new Error(`DeepSeek 生成的 ${group} 搜索 Query 不足（需要至少 ${minimum[group]} 条，实际 ${queries[group].length} 条）。请尝试提供更详细的新闻描述。`);
        }
        if (queries[group].length < limit) {
            aiPipelineState.warnings.push(`${group} 搜索 Query 仅 ${queries[group].length} 条（理想 ${limit} 条），样本可能不足`);
        }
    });
    return {
        eventSummary: sanitizeText(data.eventSummary || '').trim(),
        coreEntities: toStringArray(data.coreEntities, 12),
        ambiguousEntities: toStringArray(data.ambiguousEntities, 12),
        queries,
        seedCandidates: normalizeCandidateList(data.seedCandidates || [], 'evidence'),
    };
}

async function searchWithDoubao(apiKey, query, category) {
    const body = {
        Query: query,
        Count: category === 'keyword' ? 20 : 10,
    };
    // 关键词生成流程需要近一个月新闻
    if (category === 'keyword') body.TimeRange = 'OneMonth';
    const response = await fetch(DOUBAO_SEARCH_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    console.log(`[搜索] query="${query}"`, { status: response.status, resultCount: payload.Result?.ResultCount, webResults: (payload.Result?.WebResults || []).length });
    if (!response.ok || payload.ResponseMetadata?.Error) {
        throw new Error(payload.ResponseMetadata?.Error?.Message || payload.error || `HTTP ${response.status}`);
    }
    return (payload.Result?.WebResults || []).map((item, index) => ({
        id: '',
        expectedGroup: category,
        query,
        title: sanitizeText(item.Title || ''),
        site: sanitizeText(item.SiteName || ''),
        url: sanitizeText(item.Url || ''),
        publishTime: sanitizeText(item.PublishTime || ''),
        auth: sanitizeText(item.AuthInfoDes || ''),
        content: sanitizeText(item.Content || item.Summary || item.Snippet || ''),
        sortId: item.SortId ?? index,
    }));
}

async function runSearchPlan(apiKey, searchPlan) {
    const jobs = Object.entries(searchPlan.queries).flatMap(([category, queries]) =>
        queries.map(query => ({ category, query }))
    );
    const results = [];
    let successCount = 0;
    for (let index = 0; index < jobs.length; index += 3) {
        const batch = jobs.slice(index, index + 3);
        const settled = await Promise.allSettled(batch.map(job =>
            searchWithDoubao(apiKey, job.query, job.category)
        ));
        settled.forEach((result, offset) => {
            if (result.status === 'fulfilled') {
                successCount += 1;
                results.push(...result.value);
            } else {
                aiPipelineState.warnings.push(`${batch[offset].query}：${result.reason?.message || '搜索失败'}`);
            }
        });
    }
    // 动态阈值：至少成功一半且不少于 3 次；短输入场景下 Query 总数可能少于 12
    const minSuccess = Math.max(3, Math.ceil(jobs.length / 2));
    if (successCount < minSuccess) throw new Error(`豆包搜索仅成功 ${successCount}/${jobs.length} 次（需要至少 ${minSuccess} 次），样本不足`);
    const seen = new Set();
    return results.filter(item => {
        const key = item.url || `${item.title}|${item.site}|${item.publishTime}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        item.id = `sample-${seen.size}`;
        return true;
    }).slice(0, 80);
}

function buildSamplePayload(samples) {
    return samples.map(item => ({
        id: item.id,
        expectedGroup: item.expectedGroup,
        title: item.title,
        site: item.site,
        publishTime: item.publishTime,
        content: item.content.slice(0, 1200),
    }));
}

function createGroups(source, samples, classification) {
    const byId = new Map(samples.map(item => [item.id, item]));
    const assigned = new Set();
    const groups = {
        groupA: [{ id: 'source', title: '原始新闻', content: source }],
        groupB: [],
        groupC: [],
    };
    ['groupA', 'groupB', 'groupC'].forEach(group => {
        toStringArray(classification?.[group], samples.length).forEach(id => {
            if (byId.has(id) && !assigned.has(id)) {
                assigned.add(id);
                groups[group].push(byId.get(id));
            }
        });
    });
    return groups;
}

function normalizeMatchText(value) {
    return sanitizeText(value).normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function scoreCandidates(candidateInputs, groups) {
    const unique = new Map();
    normalizeCandidateList(candidateInputs).forEach(candidate => {
        unique.set(candidate.words.map(normalizeMatchText).sort().join('|'), candidate);
    });
    const texts = {};
    Object.entries(groups).forEach(([group, items]) => {
        texts[group] = items.map(item => ({
            ...item,
            matchText: normalizeMatchText(`${item.title || ''}\n${item.content || ''}`),
        }));
    });
    const negativeTotal = texts.groupB.length + texts.groupC.length;
    return [...unique.values()].map((candidate, index) => {
        const normalizedWords = candidate.words.map(normalizeMatchText);
        const hitItems = group => texts[group].filter(item =>
            normalizedWords.every(word => item.matchText.includes(word))
        );
        const aHits = hitItems('groupA');
        const bHits = hitItems('groupB');
        const cHits = hitItems('groupC');
        const falseHits = bHits.length + cHits.length;
        const recall = aHits.length / texts.groupA.length;
        const falsePositiveRate = negativeTotal ? falseHits / negativeTotal : null;
        const precision = (aHits.length + falseHits) ? aHits.length / (aHits.length + falseHits) : 0;
        const score = Math.max(0, Math.round((
            recall * 65
            + precision * 25
            + (falsePositiveRate === null ? 0 : (1 - falsePositiveRate) * 10)
            - (candidate.words.length === 3 ? 3 : 0)
        ) * 10) / 10);
        let tier = 'low';
        if (negativeTotal && score >= 85 && recall >= 0.75 && falsePositiveRate <= 0.05) tier = 'high';
        else if (score >= 65 && recall >= 0.5 && (falsePositiveRate === null || falsePositiveRate <= 0.15)) tier = 'medium';
        return {
            id: `candidate-${index + 1}`,
            ...candidate,
            score, recall, precision, falsePositiveRate, tier, initialTier: tier,
            evidenceHitCount: aHits.filter(item => item.id !== 'source').length,
            hits: { groupA: aHits, groupB: bHits, groupC: cHits },
            review: null,
        };
    }).sort((a, b) => b.score - a.score);
}

function applyReview(candidates, reviews) {
    const order = ['low', 'medium', 'high'];
    const byText = new Map((Array.isArray(reviews) ? reviews : []).map(item => [item.text, item]));
    candidates.forEach(candidate => {
        const review = byText.get(candidate.text);
        if (!review) return;
        const current = order.indexOf(candidate.tier);
        if (review.action === 'upgrade') candidate.tier = order[Math.min(2, current + 1)];
        if (review.action === 'downgrade') candidate.tier = order[Math.max(0, current - 1)];
        if (review.action === 'reject') candidate.tier = 'low';
        candidate.review = { action: review.action || 'keep', reason: sanitizeText(review.reason || '').slice(0, 120) };
    });
}

function renderCandidateTiers() {
    const labels = { high: '高可用', medium: '中可用', low: '低可用' };
    const container = document.getElementById('candidateTiers');
    container.innerHTML = '';
    Object.entries(labels).forEach(([tier, label]) => {
        const items = aiPipelineState.candidates.filter(item => item.tier === tier);
        const section = document.createElement('section');
        section.className = `candidate-tier ${tier}`;
        section.innerHTML = `
            <div class="candidate-tier-header">
                <span class="candidate-tier-title">${label}（${items.length}）</span>
                <span class="candidate-tier-actions">
                    <button type="button" data-select-tier="${tier}">全选本档</button>
                    <button type="button" data-clear-tier="${tier}">取消本档</button>
                </span>
            </div>
            <div class="candidate-list"></div>`;
        const list = section.querySelector('.candidate-list');
        if (!items.length) {
            list.innerHTML = '<div class="candidate-empty">暂无候选</div>';
        } else {
            items.forEach(item => {
                const row = document.createElement('label');
                row.className = 'candidate-row';
                const falseRate = item.falsePositiveRate === null ? '样本不足' : `${Math.round(item.falsePositiveRate * 100)}%`;
                const added = acceptedAiKeywords.includes(item.text);
                row.innerHTML = `
                    <input type="checkbox" class="candidate-checkbox" data-id="${item.id}" ${aiPipelineState.selectedIds.has(item.id) ? 'checked' : ''}>
                    <span class="candidate-word keyword-chip" title="按住 Ctrl 点击可回扫"></span>
                    <span class="candidate-metrics"></span>`;
                const word = row.querySelector('.candidate-word');
                word.dataset.rescanValue = item.text;
                word.textContent = item.text;
                const originLabel = document.createElement('span');
                originLabel.className = `candidate-origin ${item.origin}`;
                originLabel.textContent = item.origin === 'evidence' ? '证据候选' : (item.origin === 'inferred' ? '推断候选' : '本地兜底');
                word.appendChild(originLabel);
                const metrics = row.querySelector('.candidate-metrics');
                metrics.textContent = `评分 ${item.score}；召回 ${Math.round(item.recall * 100)}%；误伤 ${falseRate}；真实同事件样本命中 ${item.evidenceHitCount} 条${item.isInferred ? '；证据不足/含合理推断' : ''}${item.reason ? `；来源：${item.reason}` : ''}${item.review?.reason ? `；复核：${item.review.reason}` : ''}`;
                if (added) {
                    const addedLabel = document.createElement('span');
                    addedLabel.className = 'candidate-added';
                    addedLabel.textContent = '；已加入';
                    metrics.appendChild(addedLabel);
                }
                list.appendChild(row);
            });
        }
        container.appendChild(section);
    });
    document.getElementById('aiCandidates').classList.add('show');
    const d = aiPipelineState.diagnostics;
    const rejectedSummary = [...new Set(d.rejectedCandidates)].slice(0, 3).join('、');
    document.getElementById('candidateSummary').textContent =
        `补充搜索 ${d.enrichmentSuccesses}/${d.enrichmentQueries} 次，去重样本 ${d.enrichmentSamples} 条；地点轴 ${d.locationTerms} 个，表达轴 ${d.behaviorTerms} 个，覆盖组合 ${d.coverageCandidates} 个；证据事实 ${d.verifiedFacts} 条，推断事实 ${d.inferredFacts} 条；模型候选 ${d.rawCandidates} 个，最终有效 ${d.validCandidates} 个，修复补充 ${d.repairedCandidates} 个，本地补充 ${d.fallbackCandidates} 个。Group A ${aiPipelineState.samples.groupA.length} 条，Group B ${aiPipelineState.samples.groupB.length} 条，Group C ${aiPipelineState.samples.groupC.length} 条。${rejectedSummary ? `候选过滤：${rejectedSummary}。` : ''}${aiPipelineState.warnings.length ? `另有 ${aiPipelineState.warnings.length} 条警告。` : ''}`;
}

function setPipelineStatus(message, isError = false) {
    aiPipelineState.phase = isError ? 'error' : message;
    updateApiKeyStatus(message, isError);
}

function toStringArray(value, limit = 20) {
    return (Array.isArray(value) ? value : [])
        .map(item => sanitizeText(item).trim())
        .filter(Boolean)
        .slice(0, limit);
}

function prepareEventClue(data, source) {
    const coreEntities = toStringArray(data.coreEntities, 8).map(normalizeTerm).filter(Boolean);
    const candidateTerms = toStringArray(data.candidateTerms, 10).map(normalizeTerm).filter(Boolean);
    const inferredEntities = toStringArray(data.inferredEntities, 6).map(normalizeTerm).filter(Boolean);
    const locationTerms = normalizeAxisTerms(data.locationTerms, 'evidence');
    const behaviorTerms = normalizeAxisTerms(data.behaviorTerms, 'evidence');
    const enrichmentQueries = [...new Set([
        normalizeQuery(source),
        ...toStringArray(data.enrichmentQueries, 6).map(normalizeQuery),
    ].filter(Boolean))].slice(0, 6);
    return {
        eventSummary: sanitizeText(data.eventSummary || source).trim(),
        expandedSource: sanitizeText(data.expandedSource || source).trim(),
        verifiedFacts: toStringArray(data.verifiedFacts, 12),
        inferredFacts: toStringArray(data.inferredFacts, 12),
        coreEntities,
        candidateTerms,
        inferredEntities,
        locationTerms,
        behaviorTerms,
        enrichmentQueries,
    };
}

async function analyzeEventClue(source) {
    const data = await callDeepSeekJson(
        'event-clue-analysis',
        '事件线索分析',
        { source },
    );
    return prepareEventClue(data, source);
}

async function runEnrichmentSearch(apiKey, source, clue) {
    const queries = [...new Set([source, ...(clue.enrichmentQueries || [])].map(normalizeQuery).filter(Boolean))].slice(0, 6);
    const results = [];
    let successCount = 0;
    for (let index = 0; index < queries.length; index += 3) {
        const batch = queries.slice(index, index + 3);
        const settled = await Promise.allSettled(batch.map(query => searchWithDoubao(apiKey, query, 'enrichment')));
        settled.forEach((result, offset) => {
            if (result.status === 'fulfilled') {
                successCount += 1;
                results.push(...result.value);
            } else {
                aiPipelineState.warnings.push(`补充搜索“${batch[offset]}”失败：${result.reason?.message || '未知错误'}`);
            }
        });
    }
    const seen = new Set();
    const samples = results.filter(item => {
        const key = item.url || `${item.title}|${item.site}|${item.publishTime}`;
        if (!key || seen.has(key)) return false;
        seen.add(key);
        item.id = `evidence-${seen.size}`;
        return true;
    }).slice(0, 30);
    return { queries, successCount, samples };
}

async function buildEventDossier(source, clue, evidenceSamples) {
    const data = await callDeepSeekJson(
        'evidence-merge',
        '搜索证据归并',
        {
            source,
            clue,
            evidenceSamples: buildSamplePayload(evidenceSamples.slice(0, 16)),
        },
    );
    const dossier = prepareEventClue(data, source);
    dossier.coreEntities = [...new Set([...clue.coreEntities, ...dossier.coreEntities])];
    dossier.candidateTerms = [...new Set([...clue.candidateTerms, ...dossier.candidateTerms])];
    dossier.inferredEntities = [...new Set([...clue.inferredEntities, ...dossier.inferredEntities])];
    dossier.locationTerms = normalizeAxisTerms([...clue.locationTerms, ...dossier.locationTerms]);
    dossier.behaviorTerms = normalizeAxisTerms([...clue.behaviorTerms, ...dossier.behaviorTerms]);
    return dossier;
}

const KEYWORD_CATEGORIES = [
    ['person', '主体'],
    ['event', '事件'],
    ['location', '地点'],
    ['action', '关键动作'],
];

function normalizeKeywordTerm(value, category = '') {
    const term = sanitizeText(value)
        .replace(/^['"`“”‘’]+|['"`“”‘’]+$/g, '')
        .replace(/\s+/g, '')
        .trim();
    if (!term || term.length < 2 || term.length > 14 || /[。！？；：]/.test(term)) return '';
    const entitySuffixPattern = /(队|局|部|委|办|厅|院|所|站|馆|校|厂|店|村|镇|区|县|市|省|国|公司|集团|学校|大学|医院|景区|公园|政府|法院|平台|品牌|长城)$/;
    const overComposedPattern = /(事件|事故|问题|情况|过程|行为|争议|风波|通报|处理)$/;
    const actionChainPattern = /(被|遭|反遭|导致|引发|造成|劝阻|辱骂|插队|回应|处置|处理|通报)/;
    if (term.length > 8 && overComposedPattern.test(term)) return '';
    if (term.length > 8 && actionChainPattern.test(term) && !entitySuffixPattern.test(term)) return '';
    if ((category === 'event' || category === 'action') && term.length > 8) return '';
    return term;
}

function normalizeKeywordCandidates(data) {
    const unique = new Map();
    KEYWORD_CATEGORIES.forEach(([category]) => {
        const items = Array.isArray(data?.categories?.[category]) ? data.categories[category] : [];
        items.forEach(item => {
            const term = normalizeKeywordTerm(item?.term ?? item, category);
            if (!term) return;
            const key = normalizeMatchText(term);
            if (unique.has(key)) return;
            const relevance = Number(item?.relevance);
            const tier = ['high', 'medium', 'low'].includes(item?.tier)
                ? item.tier
                : (relevance >= 80 ? 'high' : (relevance >= 55 ? 'medium' : 'low'));
            unique.set(key, {
                id: `keyword-${unique.size + 1}`,
                text: term,
                term,
                category,
                tier,
                origin: item?.origin === 'inferred' ? 'inferred' : 'evidence',
                reason: sanitizeText(item?.reason || '').trim().slice(0, 80),
                relevance: Number.isFinite(relevance) ? Math.max(0, Math.min(100, relevance)) : null,
            });
        });
    });
    return [...unique.values()];
}

async function buildKeywordSearchPlan(source) {
    console.group('[AI 步骤 1/3] 检索计划生成');
    console.log('输入原文', source);
    const data = await callDeepSeekJson(
        'keyword-search-plan',
        '检索计划生成',
        { source },
    );
    console.log('DeepSeek 返回', data);
    // 原始输入可能过长，不适合直接作为搜索词；完全依赖 DeepSeek 生成的查询。
    const queries = toStringArray(data.queries, 8).map(normalizeQuery).filter(Boolean).slice(0, 5);
    console.log('最终搜索 query', queries);
    console.groupEnd();
    if (!queries.length) throw new Error('未能生成可用的联网检索词');
    return queries;
}

async function runKeywordSearch(apiKey, queries) {
    console.group('[AI 步骤 2/3] 联网搜索');
    const settled = await Promise.allSettled(queries.map(query => searchWithDoubao(apiKey, query, 'keyword')));
    const samples = [];
    const seen = new Set();
    settled.forEach((result, index) => {
        if (result.status !== 'fulfilled') {
            const errMsg = result.reason?.message || '未知错误';
            console.warn(`query "${queries[index]}" 失败`, errMsg);
            aiPipelineState.warnings.push(`检索"${queries[index]}"失败：${errMsg}`);
            return;
        }
        const items = result.value;
        console.log(`query "${queries[index]}" 返回 ${items.length} 条结果`, items.slice(0, 3).map(item => ({ title: item.title, url: item.url, site: item.site })));
        items.forEach(item => {
            const key = item.url || `${item.title}|${item.site}`;
            if (!key || seen.has(key) || samples.length >= 24) return;
            seen.add(key);
            samples.push(item);
        });
    });
    console.log(`去重后共 ${samples.length} 条样本`);
    console.groupEnd();
    if (!samples.length) {
        const reasons = aiPipelineState.warnings.slice(-3).join('；');
        throw new Error(`联网搜索未返回可用新闻。${reasons ? `详情：${reasons}` : '请检查搜索 API Key 或更换更具体的标题。'}`);
    }
    return samples;
}

function renderKeywordTiers() {
    const tierLabels = { high: '高可用', medium: '中可用', low: '低可用' };
    const container = document.getElementById('candidateTiers');
    container.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'candidate-category-grid';
    KEYWORD_CATEGORIES.forEach(([category, categoryLabel]) => {
        const items = aiPipelineState.candidates
            .filter(item => item.category === category)
            .sort((a, b) => {
                const order = { high: 0, medium: 1, low: 2 };
                return order[a.tier] - order[b.tier] || (b.relevance ?? 0) - (a.relevance ?? 0);
            });
        const section = document.createElement('section');
        section.className = 'candidate-category-card';
        section.innerHTML = `
            <div class="candidate-category-header">
                <span class="candidate-category-title">${categoryLabel}（${items.length}）</span>
                <span class="candidate-tier-actions"></span>
            </div>
            <div class="keyword-button-list"></div>`;
        const actions = section.querySelector('.candidate-tier-actions');
        document.querySelectorAll('.column:not(#manualColumn)').forEach((column, index) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.dataset.addCategoryToColumn = category;
            button.dataset.column = column.dataset.columnIndex;
            button.textContent = `加入组合列${index + 1}`;
            actions.appendChild(button);
        });
        const manualButton = document.createElement('button');
        manualButton.type = 'button';
        manualButton.dataset.addCategoryToManual = category;
        manualButton.textContent = '加入单独添加列';
        actions.appendChild(manualButton);
        const list = section.querySelector('.keyword-button-list');
        if (!items.length) {
            list.innerHTML = '<div class="candidate-empty">暂无候选</div>';
        }
        items.forEach(item => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = `keyword-chip ${item.tier}${aiPipelineState.selectedIds.has(item.id) ? ' selected' : ''}`;
            chip.dataset.id = item.id;
            chip.dataset.rescanValue = item.text;
            chip.title = `${tierLabels[item.tier]}；相关性 ${item.relevance ?? '未评分'}${item.reason ? `；${item.reason}` : ''}；按住 Ctrl 点击可回扫`;
            chip.textContent = item.text;
            list.appendChild(chip);
        });
        grid.appendChild(section);
    });
    container.appendChild(grid);
    document.getElementById('aiCandidates').classList.add('show');
}

function getSelectedKeywordTexts(category = '') {
    return aiPipelineState.candidates
        .filter(item => aiPipelineState.selectedIds.has(item.id))
        .filter(item => !category || item.category === category)
        .map(item => item.text);
}

function addSelectedCategoryKeywordsToColumn(category, columnIndex) {
    const selected = getSelectedKeywordTexts(category);
    const label = Object.fromEntries(KEYWORD_CATEGORIES)[category] || '当前分类';
    if (!selected.length) {
        document.getElementById('candidateActionStatus').textContent = `请先选择${label}中的至少一个关键词。`;
        return;
    }
    const added = addKeywordsToColumn(selected, columnIndex);
    document.getElementById('candidateActionStatus').textContent = `已将${label}中选中的 ${added} 个关键词加入组合列${Number(columnIndex) + 1}，重复项已忽略。`;
}

function addSelectedCategoryKeywordsToManual(category) {
    const selected = getSelectedKeywordTexts(category);
    const label = Object.fromEntries(KEYWORD_CATEGORIES)[category] || '当前分类';
    if (!selected.length) {
        document.getElementById('candidateActionStatus').textContent = `请先选择${label}中的至少一个关键词。`;
        return;
    }
    const added = addKeywordsToManual(selected);
    document.getElementById('candidateActionStatus').textContent = `已将${label}中选中的 ${added} 个关键词加入单独添加列，重复项已忽略。`;
}

function autoFillPrimaryKeywordColumns(candidates) {
    const topByCategory = category => candidates
        .filter(item => item.category === category)
        .sort((a, b) => {
            const order = { high: 0, medium: 1, low: 2 };
            return order[a.tier] - order[b.tier] || (b.relevance ?? 0) - (a.relevance ?? 0);
        })
        .slice(0, 1);
    const topPersons = topByCategory('person');
    const topEvents = topByCategory('event');
    const addedPerson = addKeywordsToColumn(topPersons.map(item => item.text), 0);
    const addedEvent = addKeywordsToColumn(topEvents.map(item => item.text), 1);
    return { addedPerson, addedEvent, selectedIds: [...topPersons, ...topEvents].map(item => item.id) };
}

async function generateKeywordCandidates() {
    const source = sanitizeText(document.getElementById('newsSourceInput').value).trim();
    const doubaoKey = CONFIGURED_DOUBAO_SEARCH_API_KEY;
    const button = document.getElementById('aiGenerateBtn');
    if (!source) return setPipelineStatus('请先输入新闻标题、正文或链接。', true);
    if (!DOUBAO_SEARCH_API_URL) return setPipelineStatus('请先配置 Cloudflare Worker 搜索代理地址。', true);
    if (!DEEPSEEK_PROXY_API_URL) return setPipelineStatus('请先配置 DeepSeek AI 服务代理地址。', true);
    if (!doubaoKey) return setPipelineStatus('请先在 app-config.js 或 GitHub Variables 中配置豆包搜索 API Key。', true);

    button.disabled = true;
    button.textContent = '正在联网检索…';
    aiPipelineState.warnings = [];
    aiPipelineState.selectedIds.clear();
    try {
        setPipelineStatus('1/3 正在规划近一个月新闻检索…');
        const queries = await buildKeywordSearchPlan(source);
        setPipelineStatus('2/3 正在联网搜索并筛选新闻来源…');
        const samples = await runKeywordSearch(doubaoKey, queries);
        console.group('[AI 步骤 3/3] 关键词提取');
        console.log('搜索样本数', samples.length);
        const data = await callDeepSeekJson(
            'keyword-extraction',
            '新闻关键词提取',
            {
                source,
                searchResults: samples.map(item => ({
                    title: item.title,
                    url: item.url,
                    publishTime: item.publishTime,
                    content: item.content.slice(0, 1000),
                })),
            },
        );
        const candidates = normalizeKeywordCandidates(data);
        if (!candidates.length) throw new Error('模型未返回合法关键词，请换用更具体的新闻标题');
        aiPipelineState.candidates = candidates;
        console.log('DeepSeek 返回 categories', {
            event: (data.categories?.event || []).length,
            person: (data.categories?.person || []).length,
            location: (data.categories?.location || []).length,
            action: (data.categories?.action || []).length,
        });
        console.log('eventSummary', sanitizeText(data.eventSummary || ''));
        console.log('sources', data.sources);
        console.log('标准化后候选词数', candidates.length);
        console.groupEnd();
        const knownUrls = new Set(samples.map(item => item.url).filter(Boolean));
        const sourceLinks = (Array.isArray(data.sources) ? data.sources : [])
            .filter(item => knownUrls.has(item?.url))
            .slice(0, 5);
        if (sourceLinks.length < 3) {
            samples.slice(0, 5).forEach(item => {
                if (sourceLinks.length < 5 && item.url && !sourceLinks.some(link => link.url === item.url)) {
                    sourceLinks.push({ title: item.title, url: item.url });
                }
            });
        }
        const summary = sanitizeText(data.eventSummary || '').trim();
        document.getElementById('candidateSummary').replaceChildren();
        document.getElementById('candidateSummary').append(`${summary || '已完成关键词提取。'} 已检索 ${samples.length} 条结果，展示来源：`);
        sourceLinks.forEach((item, index) => {
            const link = document.createElement('a');
            link.href = item.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = `${index + 1}. ${sanitizeText(item.title || '新闻链接')}`;
            document.getElementById('candidateSummary').append(' ', link);
        });
        const autoFill = autoFillPrimaryKeywordColumns(candidates);
        autoFill.selectedIds.forEach(id => aiPipelineState.selectedIds.add(id));
        refreshCandidateTargetColumns();
        renderKeywordTiers();
        setPipelineStatus(`3/3 完成：生成 ${candidates.length} 个关键词；已自动加入第1列最高置信主体 ${autoFill.addedPerson} 个、第2列最高置信事件 ${autoFill.addedEvent} 个，其余请手动判断。`);
        document.getElementById('aiCandidates').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
        setPipelineStatus(`生成失败：${error?.message || '未知错误'}`, true);
    } finally {
        button.disabled = false;
        button.textContent = '联网生成关键词';
    }
}

async function repairCandidateSet(dossier, plan, validCandidates, rejectedCandidates) {
    const data = await callDeepSeekJson(
        'candidate-repair',
        '候选格式修复',
        {
            eventDossier: dossier,
            planEntities: plan.coreEntities,
            validCandidates: validCandidates.map(item => ({ words: item.words, origin: item.origin })),
            rejectedReasons: rejectedCandidates.slice(0, 20),
        },
    );
    return Array.isArray(data.candidates) ? data.candidates : [];
}

function selectCandidateTier(tier, selected) {
    aiPipelineState.candidates
        .filter(item => item.tier === tier)
        .forEach(item => {
            if (selected) aiPipelineState.selectedIds.add(item.id);
            else aiPipelineState.selectedIds.delete(item.id);
        });
    renderCandidateTiers();
}

function addSelectedCandidates() {
    const selected = aiPipelineState.candidates
        .filter(item => aiPipelineState.selectedIds.has(item.id))
        .map(item => item.text);
    if (!selected.length) {
        document.getElementById('candidateActionStatus').textContent = '请先选择至少一个候选词组。';
        return;
    }
    const previousSize = acceptedAiKeywords.length;
    acceptedAiKeywords = [...new Set([...acceptedAiKeywords, ...selected])];
    updateOutput();
    renderCandidateTiers();
    document.getElementById('candidateActionStatus').textContent =
        `已加入 ${acceptedAiKeywords.length - previousSize} 个新词组，重复项已自动忽略。`;
}

function getOutputLines() {
    const textarea = document.getElementById('outputTextarea');
    return textarea.value
        .split('\n')
        .map(s => sanitizeText(s).trim())
        .filter(Boolean);
}

function renderOutputChips(lines) {
    const container = document.getElementById('outputChipList');
    if (!container) return;
    container.innerHTML = '';
    if (!lines.length) {
        const empty = document.createElement('span');
        empty.className = 'output-chip-empty';
        empty.textContent = '暂无词组';
        container.appendChild(empty);
        return;
    }
    lines.forEach(line => {
        const chip = document.createElement('span');
        chip.className = 'keyword-chip';
        chip.dataset.rescanValue = line;
        chip.title = '按住 Ctrl 点击可回扫';
        chip.textContent = line;
        container.appendChild(chip);
    });
}

function setOutputLines(lines) {
    const normalizedLines = lines.map(s => sanitizeText(s).trim()).filter(Boolean);
    document.getElementById('outputTextarea').value = normalizedLines.join('\n');
    renderOutputChips(normalizedLines);
}

function renderModalList() {
    const container = document.getElementById('resultList');
    container.innerHTML = '';
    modalLines.forEach((line, index) => {
        const row = document.createElement('div');
        row.className = 'result-row';
        row.innerHTML = `
            <input class="result-checkbox" type="checkbox" data-index="${index}">
            <span class="result-text keyword-chip" data-index="${index}" title="点击编辑；按住 Ctrl 点击可回扫"></span>
        `;
        const resultText = row.querySelector('.result-text');
        resultText.dataset.rescanValue = line;
        resultText.textContent = line;
        container.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'result-add-btn';
    addBtn.id = 'resultAddBtn';
    addBtn.textContent = '+';
    container.appendChild(addBtn);
}

function openResultModal() {
    modalLines = getOutputLines();
    renderModalList();
    document.getElementById('resultModal').classList.add('show');
}

function closeResultModal() {
    document.getElementById('resultModal').classList.remove('show');
}

function deleteSelectedLines() {
    const checks = Array.from(document.querySelectorAll('#resultList .result-checkbox:checked'));
    if (checks.length === 0) return;
    const indices = new Set(checks.map(c => Number(c.dataset.index)));
    modalLines = modalLines.filter((_, i) => !indices.has(i));
    setOutputLines(modalLines);
    renderModalList();
}

function startEditLine(index) {
    const rows = document.querySelectorAll('#resultList .result-row');
    const row = rows[index];
    if (!row) return;
    const textEl = row.querySelector('.result-text');
    if (!textEl) return;
    const current = modalLines[index] ?? '';
    const input = document.createElement('input');
    input.className = 'result-input';
    input.value = current;
    textEl.replaceWith(input);
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    const commit = () => {
        const value = sanitizeText(input.value).trim();
        if (!value) {
            modalLines.splice(index, 1);
        } else {
            modalLines[index] = value;
        }
        setOutputLines(modalLines);
        renderModalList();
    };

    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') renderModalList();
    });
}

function addTempLine() {
    modalLines.push('');
    renderModalList();
    startEditLine(modalLines.length - 1);
}

function copyResult() {
    const textarea = document.getElementById('outputTextarea');
    if (!textarea.value) return;
    navigator.clipboard.writeText(textarea.value).then(() => {
        const btn = document.getElementById('copyBtn');
        btn.textContent = '已复制';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = '复制结果并跳转至业务安全平台'; btn.classList.remove('copied'); }, 2000);
        window.open('https://safe.bytedance.net/strategy/antidirt2/tag_list/detail/6180', '_blank');
    });
}

function exportToCsv() {
    const lines = getOutputLines();
    if (lines.length === 0) {
        alert('导出结果为空');
        return;
    }

    window.open('https://bee.bytedance.net/1533/combine-imc/16410/data', '_blank');

    const now = new Date();
    const fileYear = now.getFullYear();
    const fileMonth = String(now.getMonth() + 1).padStart(2, '0');
    const fileDay = String(now.getDate()).padStart(2, '0');
    const fileHours = String(now.getHours()).padStart(2, '0');
    const fileMinutes = String(now.getMinutes()).padStart(2, '0');
    const fileSeconds = String(now.getSeconds()).padStart(2, '0');
    const fileTimestamp = `${fileYear}${fileMonth}${fileDay}_${fileHours}${fileMinutes}${fileSeconds}`;

    const expireDate = new Date();
    expireDate.setMonth(expireDate.getMonth() + 1);
    const year = expireDate.getFullYear();
    const month = String(expireDate.getMonth() + 1).padStart(2, '0');
    const day = String(expireDate.getDate()).padStart(2, '0');
    const hours = String(expireDate.getHours()).padStart(2, '0');
    const minutes = String(expireDate.getMinutes()).padStart(2, '0');
    const seconds = String(expireDate.getSeconds()).padStart(2, '0');
    const expireTime = `${year}/${month}/${day} ${hours}:${minutes}:${seconds}`;

    const normalizeCsvCell = (value) => String(value ?? '')
        .replace(/\0/g, '')
        .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim();
    const escapeCsvCell = (value) => {
        const text = normalizeCsvCell(value);
        return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const worksheetData = [
        ['stop_keyword', 'expire_time'],
        ...lines.map(keyword => [normalizeCsvCell(keyword), expireTime])
    ];
    const csvContent = worksheetData
        .map(row => row.map(escapeCsvCell).join(','))
        .join('\r\n');
    const blob = new Blob(['\uFEFF', csvContent], {
        type: 'text/csv;charset=utf-8'
    });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `拆词表_${fileTimestamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
}

function openFeishuDoc() {
    window.open('https://bytedance.larkoffice.com/docx/Lb9nd9TDFoPdQkxZsfacUbFPnff', '_blank');
}

function openFeishuSheet() {
    window.open('https://bytedance.larkoffice.com/sheets/X3lzs3LKOhsJ1Bth11Cc7wXvndf', '_blank');
}

function getQuickRescanDateRange() {
    const now = new Date();
    return {
        startMs: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0).getTime(),
        endMs: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0).getTime() - 1
    };
}

function getQuickRescanParts(value) {
    return value.split(/[，,;；\s]+/).map(item => item.trim()).filter(Boolean);
}

function isNumericRescanValue(value) {
    return /^[\d，,;；\s]+$/.test(value) && /\d/.test(value);
}

function setQuickRescanStatus(message = '') {
    document.getElementById('quickRescanStatus').textContent = message;
}

function openRescan(type, value, genTypeList = []) {
    const keyword = sanitizeText(value).trim();
    if (!keyword) return false;
    const { startMs, endMs } = getQuickRescanDateRange();
    const isGid = type === 'gid';
    const url = new URL(`https://imc.bytedance.net/tools/push-intercept/${isGid ? 'material-group' : 'material-intercept'}`);
    url.searchParams.set('curAppId', '1128');
    url.searchParams.set('isNewTask', '0');
    url.searchParams.set('startCreateTime', String(startMs));
    url.searchParams.set('endCreateTime', String(endMs));
    url.searchParams.set('pageNum', '1');
    if (isGid) {
        url.searchParams.set('isSimilar', '0');
    }
    if (isNumericRescanValue(keyword)) {
        url.searchParams.set('groupIds', getQuickRescanParts(keyword).join(','));
    } else {
        getQuickRescanParts(keyword).forEach(item => {
            url.searchParams.append('materialValueList', item);
        });
    }
    genTypeList.forEach(gt => {
        url.searchParams.append('genTypeList', gt);
    });
    window.open(url.toString(), '_blank');
    return true;
}

function openQuickRescan(type) {
    const input = document.getElementById('quickRescanInput');
    const keyword = input.value.trim();
    if (!keyword) {
        setQuickRescanStatus('请先输入需要回扫的 GID 或素材 ID');
        input.focus();
        return;
    }
    setQuickRescanStatus('');
    const genTypeList = [];
    if (document.getElementById('quickRescanManual').checked) genTypeList.push('manual');
    if (document.getElementById('quickRescanAigc').checked) genTypeList.push('aigc');
    openRescan(type, keyword, genTypeList);
}

function closeKeywordRescanMenu() {
    if (!activeKeywordRescanMenu) return;
    activeKeywordRescanMenu.remove();
    activeKeywordRescanMenu = null;
}

function positionKeywordRescanMenu(menu, anchor) {
    const gap = 8;
    const margin = 12;
    const anchorRect = anchor.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    let left = anchorRect.left;
    let top = anchorRect.bottom + gap;
    if (left + menuRect.width > window.innerWidth - margin) {
        left = window.innerWidth - menuRect.width - margin;
    }
    if (top + menuRect.height > window.innerHeight - margin) {
        top = anchorRect.top - menuRect.height - gap;
    }
    menu.style.left = `${Math.max(margin, left)}px`;
    menu.style.top = `${Math.max(margin, top)}px`;
}

function showKeywordRescanMenu(chip) {
    closeKeywordRescanMenu();
    const value = sanitizeText(chip.dataset.rescanValue || chip.textContent).trim();
    if (!value) return;

    const menu = document.createElement('div');
    menu.className = 'keyword-rescan-menu';
    menu.setAttribute('role', 'dialog');
    menu.setAttribute('aria-label', '关键词回扫');

    const title = document.createElement('div');
    title.className = 'keyword-rescan-title';
    title.textContent = `回扫：${value}`;

    const manualLabel = document.createElement('label');
    manualLabel.className = 'keyword-rescan-manual';
    const manualCheckbox = document.createElement('input');
    manualCheckbox.type = 'checkbox';
    manualLabel.append(manualCheckbox, document.createTextNode('人审'));

    const aigcLabel = document.createElement('label');
    aigcLabel.className = 'keyword-rescan-manual';
    const aigcCheckbox = document.createElement('input');
    aigcCheckbox.type = 'checkbox';
    aigcLabel.append(aigcCheckbox, document.createTextNode('AIGC'));

    const actions = document.createElement('div');
    actions.className = 'keyword-rescan-actions';
    [['gid', '回扫 GID'], ['material', '回扫素材']].forEach(([type, label]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'keyword-rescan-action';
        button.textContent = label;
        button.addEventListener('click', () => {
            const genTypeList = [];
            if (manualCheckbox.checked) genTypeList.push('manual');
            if (aigcCheckbox.checked) genTypeList.push('aigc');
            openRescan(type, value, genTypeList);
            closeKeywordRescanMenu();
        });
        actions.appendChild(button);
    });

    menu.append(title, manualLabel, aigcLabel, actions);
    document.body.appendChild(menu);
    activeKeywordRescanMenu = menu;
    positionKeywordRescanMenu(menu, chip);
}

document.addEventListener('DOMContentLoaded', () => {
    configureAiServiceLogin();
    updateApiKeyStatus();
    refreshCandidateTargetColumns();
    renderOutputChips(getOutputLines());
    document.addEventListener('click', (e) => {
        const chip = e.target.closest('.keyword-chip');
        if (e.ctrlKey && chip && !chip.closest('.keyword-rescan-menu')) {
            e.preventDefault();
            e.stopImmediatePropagation();
            showKeywordRescanMenu(chip);
            return;
        }
        if (activeKeywordRescanMenu && !activeKeywordRescanMenu.contains(e.target)) {
            closeKeywordRescanMenu();
        }
    }, true);
    window.addEventListener('resize', closeKeywordRescanMenu);
    window.addEventListener('scroll', closeKeywordRescanMenu, true);
    document.getElementById('aiGenerateBtn').addEventListener('click', generateKeywordCandidates);
    document.getElementById('candidateTiers').addEventListener('change', (e) => {
        const checkbox = e.target.closest('.candidate-checkbox');
        if (!checkbox) return;
        if (checkbox.checked) aiPipelineState.selectedIds.add(checkbox.dataset.id);
        else aiPipelineState.selectedIds.delete(checkbox.dataset.id);
    });
    document.getElementById('candidateTiers').addEventListener('click', (e) => {
        const chip = e.target.closest('.keyword-chip');
        const addColumnButton = e.target.closest('[data-add-category-to-column]');
        const addManualButton = e.target.closest('[data-add-category-to-manual]');
        if (chip) {
            if (aiPipelineState.selectedIds.has(chip.dataset.id)) aiPipelineState.selectedIds.delete(chip.dataset.id);
            else aiPipelineState.selectedIds.add(chip.dataset.id);
            renderKeywordTiers();
            return;
        }
        if (addColumnButton) {
            addSelectedCategoryKeywordsToColumn(addColumnButton.dataset.addCategoryToColumn, addColumnButton.dataset.column);
            return;
        }
        if (addManualButton) {
            addSelectedCategoryKeywordsToManual(addManualButton.dataset.addCategoryToManual);
        }
    });
    document.getElementById('addColumnBtn').addEventListener('click', addColumn);
    document.getElementById('exportCsvBtn').addEventListener('click', exportToCsv);
    document.getElementById('copyBtn').addEventListener('click', copyResult);
    document.getElementById('feishuDocBtn').addEventListener('click', openFeishuDoc);
    document.getElementById('feishuSheetBtn').addEventListener('click', openFeishuSheet);
    document.getElementById('quickScanGidBtn').addEventListener('click', () => openQuickRescan('gid'));
    document.getElementById('quickScanMaterialBtn').addEventListener('click', () => openQuickRescan('material'));
    document.getElementById('quickRescanInput').addEventListener('keydown', (event) => {
        if (event.key === 'Enter') openQuickRescan('gid');
    });
    document.getElementById('manualAddBtn').addEventListener('click', addManualKeyword);
    document.getElementById('generateBtn').addEventListener('click', openResultModal);
    document.getElementById('deleteSelectedBtn').addEventListener('click', deleteSelectedLines);
    document.getElementById('resultModalCloseBtn').addEventListener('click', closeResultModal);
    document.getElementById('resultModal').addEventListener('click', (e) => {
        if (e.target && e.target.id === 'resultModal') closeResultModal();
    });
    document.getElementById('resultList').addEventListener('click', (e) => {
        const addBtn = e.target.closest('#resultAddBtn');
        if (addBtn) {
            addTempLine();
            return;
        }
        const el = e.target.closest('.result-text');
        if (!el) return;
        startEditLine(Number(el.dataset.index));
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeKeywordRescanMenu();
            closeResultModal();
        }
    });
    document.addEventListener('click', (e) => {
        const removeColumnButton = e.target.closest('[data-remove-column]');
        if (removeColumnButton) {
            removeColumn(removeColumnButton);
            return;
        }
        const btn = e.target.closest('.add-noun-btn');
        if (btn && btn.id !== 'manualAddBtn') {
            const columnIndex = parseInt(btn.dataset.column);
            addNoun(columnIndex);
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.target.classList.contains('noun-input') && e.key === 'Enter') {
            if (e.target.id === 'manualKeywordInput') addManualKeyword();
            else {
                const columnIndex = parseInt(e.target.id.replace('nounInput', ''));
                addNoun(columnIndex);
            }
        }
    });
});
