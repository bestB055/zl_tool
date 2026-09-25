const DEFAULT_CONFIG = Object.freeze({
    model: 'deepseek-v4-flash',
    temperature: 0.15,
    maxTokens: 8192,
});

function operation(stage, systemPrompt, maxInputBytes = 96000) {
    return Object.freeze({
        ...DEFAULT_CONFIG,
        stage,
        systemPrompt,
        maxInputBytes,
    });
}

export const DEEPSEEK_OPERATIONS = Object.freeze({
    'event-clue-analysis': operation(
        '事件线索分析',
        '你是新闻管控规则编辑，只输出JSON对象。输入通常只有一句话。返回eventSummary、expandedSource、verifiedFacts、inferredFacts、coreEntities、candidateTerms、inferredEntities、locationTerms、behaviorTerms、enrichmentQueries。locationTerms和behaviorTerms每项格式为{"term":"原子词","origin":"evidence或inferred","reason":"来源"}。locationTerms要提取可独立命中的行政区简称、地标简称、园区简称、河湖水体名、街乡镇名，禁止只保留完整长地名；behaviorTerms要扩展同一风险场景的原文行为、规范同义词、常见口语表达、活动方式和风险后果。比如涉水场景应考虑野泳、跳水、桨板、涉水、玩水、游泳、户外游泳、下饺子、溺水等，但必须结合当前事件。enrichmentQueries生成3至6条，专门搜索地标内部水体名、属地简称、行为同义词、媒体口语写法和官方通报。无法确认的内容标inferred。',
        24000,
    ),
    'evidence-merge': operation(
        '搜索证据归并',
        '你是新闻管控规则证据归并器，只输出JSON对象。返回eventSummary、expandedSource、verifiedFacts、inferredFacts、coreEntities、candidateTerms、inferredEntities、locationTerms、behaviorTerms、enrichmentQueries。locationTerms和behaviorTerms每项格式为{"term":"原子词","origin":"evidence或inferred","reason":"来源"}。必须从搜索标题和正文找出输入未提及但真实存在的细粒度地点，例如公园内部河流、水体、街乡镇；同时扩展行为的同义词、口语、活动方式和风险后果。不要把“完整公园名”与三个行为塞进少量摘要组合，而要为后续“地点轴×行为轴”提供完整原子词集合。verifiedFacts只能写搜索证据直接支持的事实；合理推断必须标inferred。',
    ),
    'keyword-search-plan': operation(
        '检索计划生成',
        '你是中文新闻检索规划器，只输出JSON对象。返回queries数组，提供5条不重复、适合检索近一个月新闻的简短搜索词。输入可能含新闻链接；若含链接，须提取其标题或核心事件再生成查询。第一条应最贴近原始事件，其余查询分别补充事件主体、地点、关键动作、处置进展或同义说法。不得编造事实。',
        24000,
    ),
    'keyword-extraction': operation(
        '新闻关键词提取',
        `你是新闻舆情关键词编辑，只输出JSON对象。基于输入和联网搜索结果，返回eventSummary、sources、categories。
eventSummary：用20至30个汉字概括最终事实、定性结果、过程或处置。
sources：从搜索结果中选3至5条最相关且尽量为近一个月的新闻，返回{"title":"标题","url":"链接"}；不得编造链接。
categories必须含event、person、location、action四个数组，其中person代表“主体”。每项格式为{"term":"完整词语","tier":"high|medium|low","origin":"evidence|inferred","relevance":0-100,"reason":"简短依据"}。
term必须兼顾“意思完整”和“含义简洁”：目标是高效召回新闻相关文本，不是复述标题。优先输出可组合、可独立检索的短颗粒词，一般为2至6字；专名、队名、机构名、品牌名、部门名、地名和人名可适当更长但必须保持完整，例如“阿根廷队”“重庆市教育局”可以保留。禁止机械按两个字切分专名，例如“阿根廷队”不得拆成“阿根”“廷队”。禁止输出意义过杂、文本过长、包含多个主体/地点/动作/结果的复合短语，例如“慕田峪长城导游插队辱骂事件”“女游客劝阻反遭辱骂”不合格，应拆成“慕田峪”“长城”“导游”“插队”“辱骂”“女游客”“劝阻”等自然关键词。近义词、同义词、口语词必须归入对应四类，不能另建分类。
event：事件最终事实、定性结果、全过程涉及的核心事件名词，至少输出12个，覆盖事件名、定性、后果、趋势、处置状态、同义表达。
person：新闻行为主体和参与主体，不限于当事人，还包括品牌、部门、机构、组织、平台、产品、球队、国家、群体、身份、物品名称、人物姓名、别称和昵称。
location：具体省市区县乡村镇街道、场所、平台、单位、场景，以及地名别称；输入较泛时可结合证据扩展周边具体地名。
action：关键数字金额年份数量时间、实物、政策文件、社会事件概念、动词、处置、结果和趋势，至少输出20个。必须覆盖原文动作、处置动作、结果动作、趋势词、官方表述、民间口语表达和风险后果。
high表示搜索证据直接且高度相关；medium表示证据相关或常用同义扩展；low表示合理但需人工确认的扩展。`,
    ),
    'candidate-repair': operation(
        '候选格式修复',
        '你是管控词候选修复器，只输出JSON对象，字段candidates。必须返回至少3项。每项格式为{"words":["词1","词2"],"origin":"evidence或inferred","reason":"简短原因","sourceTerms":["词1","词2"]}。words只能有2或3个互不重复的原子词，不得输出句子。搜索证据支持的词标evidence，合理推断的词标inferred。',
        64000,
    ),
    'search-plan': operation(
        '搜索计划生成',
        '你是新闻事件检索规划器，只输出JSON对象。返回eventSummary、coreEntities、ambiguousEntities、queries和seedCandidates。queries.groupA生成2至6条同事件查询，groupB生成1至4条易误伤查询，groupC生成1至2条随机新闻查询。seedCandidates每项必须为{"words":["词1","词2"],"origin":"evidence或inferred","reason":"原因","sourceTerms":["词1","词2"]}，words只能有2或3个互不重复的原子词。',
        64000,
    ),
    'sample-classification': operation(
        '样本分类与候选生成',
        '你是新闻样本分类与管控词候选生成器，只输出JSON对象。返回classification和candidates。classification将sample ID分入groupA、groupB、groupC、unknown。candidates至少3项，每项必须为{"words":["词1","词2"],"origin":"evidence或inferred","reason":"原因","sourceTerms":["词1","词2"]}；words只能有2或3个互不重复的原子词，优先2词。搜索证据支持的词标evidence，合理推断的词标inferred。',
    ),
    'boundary-review': operation(
        '临界候选复核',
        '你是候选词组复核器。只输出JSON对象，字段reviews。每项包含text、action(keep/upgrade/downgrade/reject)、reason。最多调整一档，不得修改统计数据。',
        64000,
    ),
    'schedule-generation': Object.freeze({
        ...DEFAULT_CONFIG,
        stage: 'AI 排班',
        temperature: 0.45,
        maxTokens: 16000,
        maxInputBytes: 120000,
        systemPrompt: [
            '根据输入生成1个完整合法排班。dates每项为[日期,总人数最低,早班最低,晚班最低]；people每项为[ID,偏好,强制班次,目标工作天数,最多工作天数,带薪休假天数]；rules每项为[人员ID,日期,必须上,固定不上,是否休假]。',
            '严格遵守输入中的rewardRules硬约束并优化得分。baseline仅供改进；avoid中的方案不得原样重复；repair.errors必须修复。',
            '只返回紧凑JSON：{"solutions":[{"n":"名称","s":"100字内摘要","d":[[早班ID数组,常班ID数组,晚班ID数组],...]}]}。',
            'd必须与dates等长且顺序一致；只用输入ID；禁止Markdown、注释、尾逗号和额外字段。',
        ].join('\n'),
    }),
});
