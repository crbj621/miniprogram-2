# 四六级学习、每日挑战与校园伙伴

## 当前功能与设计

2026-10-03 新增 packageEnglish，沿用校园小程序现有账号、实时模块开关和自建服务器。同学端有单词、真题、挑战、榜单四个主分区，另有独立背词和试卷作答页；小程序英语管理页与 packageProfile 的伙伴衣橱保留。四个分区共享原生 english-nav，切换保留四级／六级，使用 redirectTo 避免重复叠加页面。背词和试卷作答页独立，白色卡片、浅色背景与科技主按钮保持整洁，原背景图片未替换。

| 功能 | 当前实现 / 文件 |
| --- | --- |
| 每日新词与旧词计划、完成后加练、天数估算、打卡 | packageEnglish/pages/index；server/services/english_learning |
| 例句四选一、自动读音、显式提示、答后全部释义与译文、拼写 | packageEnglish/pages/study |
| 32题不含听力整卷、原卷图表、错题与历史 | packageEnglish/pages/papers、attempt |
| 同题限时每日挑战、学习 / 挑战 / 练习榜 | packageEnglish/pages/challenge、rank |
| 奖励设置、内容数量与缺口 | packageEnglish/pages/admin；pages/admin/index |
| 男女伙伴、永久装扮、主题、食物喂养 | packageProfile/pages/wardrobe、components/campus-companion |
| 每日校园任务、跑步目标、评论 / 晒图 / 获赞奖励 | packageProfile/pages/tasks；server/src/campus-rewards.js |
| 四个模块及首页的独立主题配色 | utils/campus-theme.ts、styles/campus-theme.wxss |

以上前端位置相对 miniprogram。主题只改变已支持页面的卡片、按钮、边框与装饰色，不重画背景，也不打开服务器已关闭的模块。

单词发音与答题提示音使用两个独立 InnerAudioContext。新词卡渲染后自动读音；答后播放本地正确提示音 correct.wav（0.28秒）或错词提示音 retry.wav（0.24秒），单词卡切换为 correct／retry 状态，进入下一词时复位为 enter。拼写题作答前不读答案，提示音结束或失败后才播放答后词音，避免重叠。切词、隐藏和卸载会停止音频、解绑旧回调；回调同时检查播放版本、当前词版本、可见状态和销毁状态，返回页面重播当前词，卸载销毁两个上下文。发音网络失败保留手动重试按钮。

单词分区以今日进度和新词／复习两个按钮为主，计划设置、打卡历史与个人工具按需展开。背词页顶部只保留等级、模式和进度；作答后在同一单词卡展示完整词义、例句和译文，下一词按钮固定底部，切词后在新数据渲染完成时滚回顶部。错词复现增加队列时，进度分母使用服务器返回的新总数。

完成今日计划等级的新词与旧词目标后，可选择本轮1–100个新词或旧词继续加练。首页读取服务器 home.extraStudy.activeModes，优先恢复当天当前等级的未完成轮次，再校验新建轮次的数量和剩余词库；恢复不附加 extraCount，保留原队列和错词复现，因此剩余新词为零时也能完成已开始的错词复习。加练后的实际唯一学习数量进入个人记录与相应等级榜单，固定目标、待生效计划、每日奖励和原打卡时间保持原规则，重复作答不重复累计或发奖。

## 内容规模与真实性

- 四级 4,449 条、六级 3,903 条，共 8,352 个词条。每条有至少一组英中例句；重复词条合并词义和例句。词库是社区学习资料，不是已人工核验的完整官方大纲。
- 原有326条结构化题目记录保留，包括32道原创练习题和294道旧版真题；本次新增104份目录编排，每份32题，共3328条记录，本机合计3654条。该数量是题目记录数，包含共享阅读与旧卷重复记录，不等于3654道互不重复的题。
- 新增目录覆盖2019年6月至2026年6月，四级、六级各52份，均为“整卷 · 不含听力”：作文1题、阅读30题、翻译1题。阅读保留原卷26–55题，作答页共32个导航题号，作文、阅读、翻译三部分草稿在同一尝试中保存。覆盖范围以公开来源实际提供的目录编排为准，包括每级2020年7月可取得的一份，不声称囊括全国所有版本。
- 104份编排中有12份按原卷证据共享阅读来源，不能称为104份独立阅读卷。共享依据、原来源、题面哈希、替换修正与覆盖结果记录在 nonlistening-coverage.json 及各卷 coverage/source。目录按等级、年月、套号去重，优先展示新 nonlistening 卷；旧57题含听力卷、6份阅读专项和原创短练仍供旧记录、专项与历史复盘使用。
- 208道作文／翻译提供项目原创参考范文／译文、用户主动展开的提示、逐题讲解与练习自评量表。作文无唯一答案，范文按题面字数及强制首句要求编写；翻译保留原题日期、数量、地点与逻辑。量表支持人工练习自评，不是官方阅卷或自动评分。2021年6月六级三套图表作文保留原图及文字说明；有精确标注的数据逐项对照，没有精确标注的图不虚构逐年数字。
- 新阅读答案从公开参考答案提取，并与对应编号、题干、材料及选项做结构一致性核对；新增客观题解析主要由程序生成上下文与候选词／段落定位，不能称为每题人工详解。六级2023年12月第2套第48题存在公开参考A与既有机构PDF参考D的争议，当前保留已复核旧记录的D及说明，争议尚未解决；referenceDispute记录两方及来源。
- 50组PDF／答案／听力等原资料入口继续保留。它们与结构化在线卷属于不同内容类型；资料目录、下载成功或题号完整，均不能单独证明每题答案和详解已经人工核验。
- 单词发音与可下载资料由同域服务器按需获取、缓存，不让小程序额外依赖第三方 request/download 域名。上游网络或资料失效时返回明确错误。

数据在 server/data/english：content.json 是词与原有结构化题，past-exams.json 是资料入口，practice-explanations.json 是原创解析，shop.json 是商品，provenance.json 与 licenses 是来源和许可。exams 中保存题号、分区、校验来源、共享关系与完整卷／不含听力整卷／专项覆盖范围；nonlistening-coverage.json 汇总本次目录覆盖与质量边界。

scripts/import-cet-nonlistening.py 以 BeautifulSoup 读取原卷HTML，并把答案事实与对应题干、选项核对；scripts/cet-subjective-reference-cet4.json 与 cet-subjective-reference-cet6.json 保存原创主观题参考内容及精确题面SHA-256。原始HTML／PDF缓存位于项目外 Downloads/cet-all-import-20261003。旧 import-cet-exams.py 与 cet-exam-review.json 保留旧卷重建依据。图表素材在 server/public/english/exams，经 /english-assets/exams 发布。

## 开源调研与选型

检索关键词：`FSRS spaced repetition`、`CET4 CET6 vocabulary examples`、`CET past papers`、`medusa loyalty points idempotency`。

本次导航整理检索 `Tencent tdesign-miniprogram tabs tab-bar` 和 `wechat miniprogram-demo navigation tabbar`。参考 [腾讯 TDesign 分区组件](https://github.com/Tencent/tdesign-miniprogram/tree/develop/packages/components/tabs) 的受控选中状态、[微信官方示例](https://github.com/wechat-miniprogram/miniprogram-demo) 的原生页面与组件组织。使用项目已有原生控件实现子包导航，避免为了四个入口引入整套依赖。

提示音调研关键词：`miniprogram-demo createInnerAudioContext audio`。参考[微信官方音频示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/miniprogram/packageAPI/pages/media/audio/audio.js)，沿用微信原生音频API和项目页面生命周期；短提示音由 scripts/generate-study-sounds.py 生成原创PCM WAV，放在英语分包 assets/audio。

旧版真题文本参考 [wamich/english-exem-md](https://github.com/wamich/english-exem-md)（保留GPL-2.0归属），答案事实与音频对照 [0609x/CET46-Resources](https://github.com/0609x/CET46-Resources) 与新东方原题页。本次原卷采用 [四六级公开题面目录](https://english-exam.lazynote.cn/)，复用 BeautifulSoup 解析HTML；共享阅读与发现的错误链接再对照机构原卷及上述PDF仓库。没有复制商业解析或已发表范文；原创主观题讲解与程序生成的客观题定位说明分开标注。奖励参考 [Medusa loyalty-points](https://github.com/medusajs/examples/tree/main/loyalty-points) 的积分流水思路，直接复用本项目已有事务与去重键，不引入电商框架。

- 复用 [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) 5.4.2 的遗忘复习算法，使用按日调度；同轮错词由学习队列复现。
- 词库采用 [KyleBing/english-vocabulary](https://github.com/KyleBing/english-vocabulary)，固定 c4c6c80879ff17d7025c28fb853a4991c8e6be6a，保留 BSD-3-Clause 与其注明的 kajweb 数据来源。
- [ECDICT](https://github.com/skywind3000/ECDICT) 可提供释义和音标，但不满足本次成对例句需求；kajweb 原仓库许可未明确，因此未直接复制整个仓库。
- [CET4-6-past-exam-paper](https://github.com/DieDiDi/CET4-6-past-exam-paper) 用作现有资源来源参考。其他发现的 OCR 或新年份占位题库未经过完整题号、答案校验，未作为可自动判分的正式题库发布。

复用用户提供的四六级网站中的原创词、题、材料与资料目录；未导入其用户或学习进度。内容构建工具为 scripts/import-english-content.py；输入网站路径通过 --source-project 指定，来源缓存保存在项目外 Downloads。

## 人物素材与商城

运行素材位于 server/public/english/companions，通过 /english-assets 发布，不放进微信主包。原男女基础人物和既有男生完整套装保持原图；新增男女各三件透明服装层，包含汉服、古风披风与现代校园服。

现有19个商品：9件服装、2款饰品、1款鞋子、3种食物与4套主题。永久商品购买后可重复装备；食物每次购买一份库存。scripts/build-companion-outfits.js 与 build-companion-overlays.js 使用原创 SVG 生成透明 PNG，服装、鞋、饰品与基础人物在相同画布叠加。

首页人物位于圆形头像左侧。统一 campus-companion 组件在父容器播放待机呼吸、摇摆、跳跃、点头与喂食动作，所有装备层一起运动；点击人物出现鼓励对话，隐藏页面时暂停并清理互动计时器。每件新衣服只需一张静态透明素材，不需要单独做动作。当前是图片整体位移、旋转和缩放，尚不包含独立骨骼、手臂弯曲或自然眨眼。

衣橱提供穿搭热力榜。服务端按当前拥有且实际穿戴的兼容商品热力求和；同一主题应用到多个模块只计一次，未穿戴收藏与食物不计分，同分并列1、1、3。客户端上报热力无效，空榜不生成测试用户。角色性别独立于个人资料性别，英语关闭时仍可使用共用衣橱。金币不涉及真实货币、成绩加成或付费模型接口。

## 数据与维护关系

个人学习、打卡、钱包、装备与挑战记录写入现有 MariaDB app_documents。按用户锁在同一连接事务内更新档案、每日记录、卡片和流水；英语事务独立使用下一事务 READ COMMITTED，避免不同新用户缺行读取产生间隙锁死锁，其他业务默认隔离不变；图片是随代码部署的静态素材，下载缓存另在 /www/campus-data/uploads/english-cache，包含在上传目录备份。

server/src/english-content.js 读取发布内容；english-fsrs.js 负责复习调度；english-media.js 校验资料来源、文件格式与缓存；miniprogram/utils/english-api.ts 统一经 api-client 调用 english_learning。

## 验证与真实边界

本次 TypeScript与67页结构检查通过，英语服务内存186项、隔离MariaDB193项通过。加练回归覆盖未完成目标不能加练、1–100数量与资源校验、活动轮次恢复、最后一个新词答错后余额为零仍能恢复、错词复现、实际数量与榜单、跨日隔离、并发重复答案和事务失败回滚；额外学习不会重复领取每日任务金币或覆盖原打卡时间。前端回归覆盖恢复优先于新增数量校验、连续切词与状态复位，音频回归覆盖提示音结束／失败、旧回调、隐藏／返回和卸载。既有整卷回归仍检查答前不泄露答案、三部分草稿统一保存、任意题号作答、一次交卷与主观题自评。

内容检查 npm run test:cet 和来源重建 --check 均通过，验证104份编排、32题结构、原题阅读26–55号、完整主观题参考、共享来源证据、答案争议标注与旧题复用关系。本次加练服务端发布点20261004-223617，具体备份及验证见 [运维记录](operations.md)。

[两种视口的布局检查](ui-preview/english-preview.md)直接转换当前WXML/WXSS，20种场景各两种视口，共40个样例，0脚本错误、断图或横向溢出，新增已打卡加练入口与加练答对状态。图片明确标为浏览器样例。微信开发者工具[原生本地fixture](ui-preview/english-extra/native-verification.json)确认两种WAV均触发播放并正常结束，时长分别0.28／0.24秒；地图准备16、运行／暂停／恢复18、结束16。该fixture跳过业务生命周期，仅验证原生音频和地图状态，不执行登录、GPS、学习接口或奖励写入。

2026-10-04微信官方预览成功：主包1,984,620字节、英语分包133,756字节、总包2,648,771字节；[预览元数据](ui-preview/加练与跑步微信预览结果.json)，二维码 C:/Users/Administrator/Downloads/campus-extra-preview-20261004.png。真实手机登录、安卓键盘、实际听到提示音与自动发音、GPS与锁屏运动、打开PDF、草稿恢复及交卷仍须真机验证，尚未正式发布小程序。

后续扩大真题范围，应先导入完整题干、材料、选项、参考答案、解析类型、原题来源和校验状态，再允许 startExam；发现来源冲突时保留争议与证据，不能把结构校验当作语义正确性或逐题人工核验。

---

# 英语学习服务

服务名 `english_learning`，请求为 `{action, ...payload}`。使用现有登录 Bearer 与 SDK 的 `OPENID`，管理员角色来自 `global_admin.loginOpenid`，不增加第二套账号。成功 `{success:true,data}`；失败 `{success:false,msg}`。

## 接口

等级均为 `CET4` / `CET6`。

| action | payload | data |
| --- | --- | --- |
| home | level? | level、plan、today、stats、extraStudy、coins、tasks、checkins、settings |
| savePlan | level、newGoal、reviewGoal | home 字段及 appliesOn |
| startStudy | level、mode:new/review/spelling、extraCount?:1–100（新词／旧词加练） | sessionId、mode、level、extra、requestedCount、status、total、completed、index、question |
| answerStudy | sessionId、questionId、answer、activeSeconds?、rating?:hard/good/easy | feedback、correct、intervalLabel、retryScheduled、coinsEarned、session、home |
| studyHint | sessionId、questionId | hint、usedHint |
| startChallenge | level | challengeId、attemptId、level、date、status、question、deadlineAt、remainingSeconds、total、completed |
| answerChallenge | attemptId、questionId、answer | 挑战状态及 accepted |
| finishChallenge | attemptId | 挑战状态、correctCount、coinsEarned、rank、myRank；答案开放后包含 review |
| rank | type:study/challenge/exam、period:day/week/all、level | items、myRank:number/null、myScore |
| papers | level? | papers、counts、coverage（目录范围、共享编排与质量边界） |
| startExam | paperId、mode:exam/practice、level?；无 paperId 时只能 practice，可传 skill/questionIds | attemptId、mode、paper、status、questions、question、answers、drafts、deadlineAt、total、completed、index |
| saveExamDraft | attemptId、questionId、answer | attempt、feedback:null |
| answerExam | attemptId、questionId、answer 或 selfAssessment:mastered/review/null | attempt、feedback；考试模式交卷前为 null |
| examHint | attemptId、questionId | hint、usedHint |
| finishExam | attemptId | attempt 字段、objectiveScore、objectiveMaxScore、correctCount、objectiveCount、selfCheckPendingCount、review、authenticity |
| examHistory / examDetail | level / attemptId | 本人的试卷历史 / 继续作答或已交卷完整复盘 |
| wrongQuestions | level | 最新一次已判分答错的客观题；重练答对后移出 |
| challengeHistory / challengeDetail | level / attemptId | 本人的挑战历史；次日开放解析 |
| campusRewards / claimCampusRewards | 无 | date、coins、runGoalKm、runGoalFrozen、pendingRunGoal、tasks、earnedToday；claim另含coinsEarned |
| setCampusRunGoal | goalKm:0.5–20，最多一位小数 | 校园任务及今日 / 次日目标 |
| wardrobe | 无 | character、coins、catalog、owned、foodStock、equipped、assets、gameSettings、heat、equippedCount、breakdown |
| wardrobeRank | 无 | items、myRank:number/null、myHeat、total、rule；同分并列、空榜不造账号 |
| buyItem | itemId、requestId（食物必填） | 完整 wardrobe |
| equipItem | itemId、module?；卸下传空 itemId、slot:outfit/accessory/shoes/theme、module? | 完整 wardrobe |
| selectCharacter | character:boy/girl | 完整 wardrobe |
| feed | itemId、requestId | 完整 wardrobe、expression:yum、animationId |
| adminOverview | 无 | admin:{role,name}、settings、counts、coverage、limitations |
| saveGameSettings | settings | 同 adminOverview，仅 super 可写 |

普通题公开字段为 `{id,type,level,skill,sourceId,authenticity,number,section,prompt,passage,materialTitle,materialImages,options:[{id,text}],hasHint,audioUrl}`。图表作文通过materialImages显示原图，passage同时保留文字或数据说明。普通学习词题另含 `lemma/ipa/partOfSpeech/exampleEn`；拼写题只含中文释义和中文例句，词 ID 变为不含拼写答案的散列。

答前不返回答案、解析、参考范文或提示内容。主动调用 hint 才记录提示使用。答后 feedback 有 `correct/answer/correctAnswer/explanation/modelAnswer/referenceAnswer/rubric/selfAssessment`；词题还有 `meanings/examples/exampleEn/exampleZh/audioUrl`。主观题 correct 为 null、score/maxScore 为 0，保留英文范文及自评量表。

考试 answers 是行数组 `{questionId,answer,checked,draft,selfAssessment,hintUsed,feedback}`；drafts 是 `{[questionId]:answer}`。允许任意题号保存/提交；全部已提交后 question 为 null。review 为 `[{question,answer,feedback,...}]`。正式考试交卷后才开放解析，逐题练习提交后立即开放。

## 规则与存储

- 首次开始计划学习后冻结每日目标。之后 savePlan 写次日 pending，等级也随 pending 次日生效。跨等级学习可进行，只入实际等级学习榜；不能满足另一等级的日目标。
- 新词 0–100，旧词 0–500，允许一个为零，禁止同时零。保存时校验资源余量，新日与开始计划学习时再次校验。不可达时 home.plan 返回 needsUpdate、availabilityNote、newAvailable、reviewAvailable；保留用户目标，未冻结时重新保存。
- 同词当天答对只计一次。错词在同一轮稍后复现，答错不计目标。两个日目标都完成才打卡。拼写独立，不改 FSRS、不计目标/金币，只记活动时间。
- 完成今日计划后可在计划等级按1–100个新词或旧词加练，新词排除已建立卡片的词，旧词排除今日新学和已正确复习的词。home.extraStudy 返回 enabled、activeModes、maxCount、newAvailable、reviewAvailable；today 返回 extraNewCount／extraReviewCount。活动轮次恢复优先，不受新建数量或剩余未学词量限制；错词复现保留在原轮次中。额外数量进入真实记录与榜单，学习每日任务仍每种仅奖励一次，checkedAt 保留首次完成时间。
- ts-fsrs 5.4.2 使用按天调度 `enable_short_term:false`，失败使用 Again，正确默认 Good。到期优先排列旧词；用户可以提前完成自设旧词数量。
- 实际学习时长取客户端活动时间与服务器题目经过时间的较小值，单题最多 600 秒。时间仅用于显示，不用于挑战同分排序。
- 每日挑战每账号每等级一份正式尝试。所有用户同题、同选项、同时长，分别打乱顺序。服务器 deadline 拒绝迟到答案；按答对数排名，同分并列，不用完成速度打破同分。
- 默认挑战题数 20、180 秒；答案默认次日开放，这是公平与及时解析之间的可调整取舍。挑战提交有效回答不少于 min(5,题数) 才可领任务金币，每账号每日只领一次，不按四/六级重复领取。
- 默认金币新词任务 10、旧词任务 10、挑战任务 5。零目标没有对应奖励。奖励额度在每日记录建立时快照；挑战题目与时长在当日首次建立时快照。
- 学词/题榜同词/同题当天首次作答去重；题榜显示答对客观题数。共享阅读及旧卷／新nonlistening重复记录通过canonicalId去重，不能靠换套号重复刷题榜。周期 day/week/all，week 为北京时间周一至今。streak/totalCheckins 读取完整打卡历史，今日未打卡时连续数延续昨天；首页展示列表最近 31 天，不限制统计历史。
- 角色外观独立于资料性别。换外观卸下不兼容装备，保留所有权。永久装扮不重复扣币，食物每次购买一份库存；喂养只消耗库存并返回动画，不加心情或成绩数值。
- 装扮与英语共用钱包。equipItem 的主题存入 equipped.themes[module]，不改全局模块设置。共享角色衣橱在英语模块关闭时仍可用，学习/真题/排行榜遵循实时英语开关。
- 用户变更统一 `english-user:<账号散列>` 数据库锁与同连接事务；领奖 ledger 主键账号+日期+任务；食物购买、喂养按 requestId 幂等。管理员保存使用独立设置锁，权限再次验证，概览与排行榜在事务外读取。

集合：english_profiles、english_daily、english_cards、english_sessions、english_challenges、english_challenge_attempts、english_exam_attempts、english_coin_ledger、english_feed_events、english_settings。复用 app_documents，未增加 ORM 或新用户表。

## 内容边界

content.json 的两份结构化试卷为 original_mock；exams/*.json 为 past_exam。coverage.fullNonListening 只在写作1题、阅读30题、翻译1题全部齐全且共享来源有依据时为真；coverage.fullPaper 为旧含听力完整卷标记，阅读专项两者均为假。用户目录优先选择新nonlistening卷，旧卷保留给已有尝试，不从历史记录删除。past-exams.json 的PDF／音频为原始资料资源，available:false；资料索引仅有type:source、url、空downloadUrl，不能伪装PDF或自动判分真题。

多词义干扰项排除分隔后所有释义的文本交集，并优先同词性（含 n/n.、v/vt/vi 等规范化）。这不是人工完成所有同义词消歧。示例句和词义保留来源，不声称每句已逐 sense 人工标注。

## 验证

`npm run check`、`npm test`、`npm run test:cet`、`npm run check:wxml`、`npm run check:wxss`。单独执行英语内存回归使用 `node server/scripts/test-english-learning.js`。

真实MariaDB回归：在专用 `campus_english_review_*` 或 `campus_english_test_*` 空库设置DB_NAME后运行 `node server/scripts/test-english-learning.js --database`。脚本使用实际SDK，包含独立Node进程重复购买／喂养和ledger写后失败回滚，结束删除自己的夹具。生产库名被拒绝。


首次建档并发回归：在上述隔离空库运行 `node server/scripts/test-english-first-users.js`。它对照默认间隙锁行为，校验英语独立事务设置不会改变全局 / 会话配置，并按自己的账号前缀清理。

本次104份不含听力目录、自动读音与图表显示在本机实现。服务端是否已发布、公网素材是否可用及隔离SQL回归是否完成，统一以 [运维记录](operations.md) 的本次结果为准；本机完成不等于线上已经更新。


## 校园每日任务与共享金币

- 默认每日累计有效GPS运动3公里得10金币。目标0.5–20公里、最多一位小数；第一条有效GPS记录后冻结当天目标，更改在次日生效。步数估距、异常记录、其他日期不计任务。
- 当天首次公开食堂评价 / 校园评论得3金币；首次晒图得2金币。食堂评价最多4张本站上传图片，后补第一张照片按imagesAddedAt计算。内容及所属档口、菜品或动态都须公开。
- 自己的评论获得他人点赞：每个“点赞者＋评论”关系只奖励一次，默认1金币，每天最多5份。自赞、取消后重赞、重复领取无额外奖励；已有流水不因取消赞而扣回。
- 任务页、衣橱、英语首页自动结算；跑步保存和评价发布后触发同步。网络失败可在任务页重试，下次打开也会按当天实际数据核对，不使用客户端申报成绩或点赞数量。
- 与英语装扮使用同一english_profiles.coins钱包、english_coin_ledger流水和用户事务锁。跨模块来源在钱包事务前读取已提交记录，余额 / 流水 / 每日状态在同连接内原子提交。管理员可设置奖励和获赞日上限，奖励沿用当日快照。
- 英语隐藏时仍可用校园任务与衣橱；跑步、食堂或动态关闭时不发对应来源的新奖励。前端隐藏不代替服务端校验。
- 食堂接口：saveReview 的 images 缺省保留已有照片；reviews 支持 sort=latest/hot，返回 images、likeCount、isLiked、mine，热门按不同账号点赞数排序，再按更新时间和编号稳定排序。likeReview 切换本人点赞；deleteReview 仅允许评论本人删除，重复删除幂等，移除点赞关系并从评分统计排除。发布、点赞、本人删除和管理员隐藏按同一评论锁与事务提交；删除保留墓碑与原始发布时间，防止重发刷金币。前端保留删除确认、当前输入草稿与迟到响应保护。集合 canteen_review_likes 保存关系。
- 未交卷正式考试的历史correctCount为null，不进入错题列表；历史 / 详情仅允许本人读取。专项练习全部已检查后再次进入会新建尝试，所选题目顺序保留。
