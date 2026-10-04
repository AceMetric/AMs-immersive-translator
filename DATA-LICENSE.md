# 数据许可

AM 项目自行整理的 `data/core.tsv` 与由它生成的核心词库，以 CC0 1.0 Universal 公共领域贡献方式提供。贡献者在法律允许范围内放弃这些项目自有数据的版权及相关权利。完整法律文本：https://creativecommons.org/publicdomain/zero/1.0/legalcode

扩展候选为 Wikidata 结构化英中标签，按其 CC0 许可使用，词条保留实体来源链接。来源：https://www.wikidata.org/wiki/Wikidata:Licensing

`data/wikidata/` 的结构化来源快照、标签、别名、描述及分类关系均来自 Wikidata，采用 CC0-1.0。`data/glossary-audit/` 和 `data/glossary-exclusions.json` 保留项目的来源核对、清洗与编辑记录，项目自有整理部分采用 CC0-1.0。不包含 Wikipedia 正文，也未把第三方词典整体改标为 CC0。

`data/primary-sources/lean-reference/` 是 [Lean 官方语言手册](https://lean-lang.org/doc/reference/latest/)的来源核对快照，原文采用上游 **Apache-2.0** 许可，完整许可见该目录 `LICENSE.txt`。快照仅提取 HTML 正文并统一空白，保留来源、抓取时间和摘要；不将手册原文改标为 CC0。核心词条的项目译名、简短定义及编辑说明是独立整理的术语事实，不是手册全文翻译；保留对应官方章节链接。

`data/primary-sources/google-ml/` 保存 [Google for Developers Machine Learning Glossary](https://developers.google.com/machine-learning/glossary) 的官方参考文本，按页面声明的 **CC BY 4.0** 使用。来源、作者、许可链接、页面许可声明及文本转换方式保存在快照和 `ATTRIBUTION.md`；参考文本不属于项目 CC0 数据。对应术语定义和译名由项目单独核对整理，不是该词汇表的全文翻译。

模型生成本篇术语、个人录入和用户导入词库按各自记录的许可使用，并不自动获得项目的 CC0 许可。软件代码仍遵循 MIT。

## 其他官方参考文档

以下目录中的文本或代码用于具体词义的核对，均保留上游原文、固定 Git 提交、原始链接、抓取时间、摘要、`LICENSE.txt` 与 `ATTRIBUTION.md`。原文不改标为 CC0，不随插件作为运行代码加载。项目术语定义独立编写；来源署名不代表上游认可 AM 译文。

| 目录 | 来源与作者 | 参考文件许可 |
| --- | --- | --- |
| `pytorch` | [PyTorch contributors](https://github.com/pytorch/pytorch) | BSD-3-Clause |
| `spinning-up` | [OpenAI Spinning Up contributors](https://github.com/openai/spinningup) | MIT |
| `etcd` | [etcd Authors](https://github.com/etcd-io/website) | CC BY 4.0（文档文本；上游代码另为 Apache-2.0） |
| `cypress` | [Cypress.io](https://github.com/cypress-io/cypress-documentation) | MIT |
| `postgres` | [PostgreSQL Global Development Group](https://github.com/postgres/postgres) | PostgreSQL |
| `python` | [Python Software Foundation and contributors](https://github.com/python/cpython) | PSF-2.0，原许可全文同时保留历史声明 |
| `mdn` | [MDN contributors](https://github.com/mdn/content) | CC BY-SA 2.5（所引用的文档正文） |
| `transformers` | [Hugging Face contributors](https://github.com/huggingface/transformers) | Apache-2.0 |
| `cleverhans` | [CleverHans contributors](https://github.com/cleverhans-lab/cleverhans) | MIT |

上述目录均位于 `data/primary-sources/`。MDN 正文保留 CC BY-SA 2.5 许可和署名，不能因为它被放进本项目源码包就改称 MIT 或 CC0。其余来源的再分发同样须遵循各目录内的原许可。

## 公开测试语料

`data/benchmark/public-60.json` 另行保留来源的许可，不属于上述 CC0 术语库声明。只含有限段落与 HTML 内的公式表示，不含下载的图片或第三方脚本。模型译文标明为 AM 测试输出，不代表原作者或机构的官方译文。

- 《Calculus Made Easy》，Silvanus P. Thompson（1851–1916），1914 年版。Project Gutenberg 电子书 #33283 标明在美国为公共领域；其他地区需按当地法律判断。原书与电子转录信息见 https://www.gutenberg.org/ebooks/33283 。转录与整理署名：Andrew D. Hwang、Chris Curnow、Don Bindner、Distributed Proofreaders；HTML 与 SVG 更新：Laura Natal。保留逐段来源链接，仅摘录公有领域原文，不将 Gutenberg 商标或电子书许可重新声明为 CC0。
- NASA Glenn 的牛顿运动定律与能量守恒教育文字，遵循其教育、事实用途说明并保留来源；不暗示 NASA 认可 AM 或机器译文。https://www.nasa.gov/nasa-brand-center/images-and-media/
- SQLite 原仓库 README：SQLite 的代码和文档为公共领域，许可说明 https://sqlite.org/copyright.html 。语料记录了抓取时的文本摘要与来源。

语料中的 `license` 与 `licenseUrl`、段落 `url` 是具体来源依据。重新抓取时应重新核对许可和来源变化。
