# 贡献术语

欢迎从数学、物理、计算机开始贡献，后续可新增其他学科。当前通过仓库文件和用户导入共享，首版不含在线社区或自动上传功能。

1. 复制 `templates/glossary-contribution.json`，填写包名称、版本、作者、许可。
2. 一个包使用一个领域：math / physics / cs / general。新增其他领域需要同步程序枚举和词库选择界面。
3. 每条填写英文原词、中文译名、领域、明确词义、别名、适用语境、来源链接或整理说明、许可。多义词另建词义；不要把一种译名强加给所有学科。
4. 请注明实际依据，例如教材定义、领域标准、可靠双语术语表。不要伪造来源，不要把未经复核的批量模型输出标记为已审校。
5. 新贡献默认 `quality: candidate`，经过专业复核后再考虑提升为核心。核心源词条编辑于 `data/core.tsv`，特殊多义语境暂在 `scripts/build-core.mjs` 维护。
6. 运行 `node scripts/validate-contribution.mjs 你的文件.json`，再运行完整词库校验。通过 [GitHub 仓库](https://github.com/AceMetric/AMs-immersive-translator) 提交 Pull Request；也可直接共享词库文件，由用户导入预览后采用。

优先使用可自由再分发的数据许可，项目自有核心库使用 CC0-1.0。若来源要求署名，请在包和词条中保存作者、原始链接、许可，并在第三方说明中登记。不应把受限制的词典整体复制进开源包。

示例仅示范格式，不是专业审校结论。`aliases` / `contexts` 是字符串数组；CSV/TSV 中用 `|` 分隔。导入时个人采用的条目会转换为个人术语，但公开贡献仍需保留候选审校状态和来源。

Wikidata 数据清洗脚本保存英语与中文标签，剔除人名/机构明显特征、重复条目和空值，并按概念类别分领域。类别并不能证明译名正确，因此扩展库始终是候选。参考：[Wikidata 许可](https://www.wikidata.org/wiki/Wikidata:Licensing)。

当前数据收集步骤、来源快照和已完成的逐条核对记录见[术语库收集报告](docs/术语库收集报告.md)。修正采集错误时更新 `data/glossary-exclusions.json` 并附原因；核对核心词义时更新 `data/glossary-audit/core-review.json`，保留具体实体链接与来源快照，不仅填写一个布尔“通过”。自动标签相同或领域关键词命中不等于完成核心审校。

逐条记录还应包含独立编写的 `definition`、具体 `reviewNote`，以及实际读过的 `evidenceSnapshots`。Wikidata 记录填写对应 `qid`；确认新的实体后可用 `python3 scripts/collect-core-aliases.py --ids Q编号` 保存其原始数据，抓取不会自动提升审校状态。Lean 专门术语可引用官方手册：`sourceKind: primary-documentation`，保存章节链接、该章节快照路径及能定位定义的短 `evidenceLocator`。手册原文遵循 Apache-2.0，保留 `data/primary-sources/lean-reference/LICENSE.txt`，不得将其改称 CC0。项目术语定义须自行编写。

`npm run glossary:target` 除检查 1,000 条核心与 10,000 条扩展目标，还检查每个实际打包的核心条目均有完整审校记录。达到数量门槛不能掩盖剩余核心条目的缺失来源。

Google 机器学习词汇表和其他官方项目文档也可作为具体词义依据，许可列表见 [数据许可](DATA-LICENSE.md#其他官方参考文档)。使用 `scripts/collect-project-evidence.py` 中已明确登记的来源时，保存固定提交、许可、署名及实际定义位置；抓取工具不会自动生成审校结论。新增来源须同时更新许可声明和目标校验器允许列表。

对于易误锁定的核心词义，可在核对记录中设置 `requiresContext: true` 并填写明确的 `contexts`；构建器会保留该约束。它用于缺乏语境时避免强制替换，不证明关键词命中就一定选对词义。用户明确编辑或导入的个人术语仍保持最高优先级。
