# 第三方说明

插件中使用以下开源组件，保留它们的许可与署名。完整许可文本同时随安装包提供。

| 组件 | 版本 | 许可 |
| --- | --- | --- |
| react | 19.3.0 | MIT |
| react-dom | 19.3.0 | MIT |
| idb | 8.0.3 | ISC |
| lucide-react | 0.468.0 | ISC |
| mathjax-full | 3.2.2 | Apache-2.0 |
| @xmldom/xmldom | 0.9.12 | MIT |

MathJax 3.2.2 已在插件内打包，采用 SVG 输出；源码保留 mathjax-full 的许可证。WXT、TypeScript、Vite、Vitest、Playwright 是开发/构建/测试工具，其许可见依赖包。

核心术语为项目自行整理，CC0-1.0；扩展候选为 Wikidata 结构化英中标签，CC0。词条保留原始实体链接，不把未经审校的数据声明为核心。

词库收集与清洗工具使用 [OpenCC Python reimplementation](https://github.com/yichen0831/opencc-python) 0.1.7（Apache-2.0），将选定的 Wikidata 中文地区标签转换为简体。它是构建数据时使用的工具，不随 Chrome 插件运行；原始标签、地区语言和转换方式保留在清洗记录中。转换只统一字形，不宣称已解决地区译名或词义差异。

Lean 专门术语的核对依据包括 [Lean Language Reference](https://lean-lang.org/doc/reference/latest/)（Lean reference-manual contributors，Apache-2.0）。正文快照在 `data/primary-sources/lean-reference/`，保留完整上游许可；仅作为来源资料，不作为网页脚本执行或模型数据自动导入。

Google for Developers 的 [Machine Learning Glossary](https://developers.google.com/machine-learning/glossary)（CC BY 4.0）用于机器学习专门词义的来源核对。HTML 文本转换及署名见 `data/primary-sources/google-ml/ATTRIBUTION.md`，原参考文本继续保留其许可，不随扩展作为网页脚本执行。

其他固定版本的官方参考资料包括 PyTorch（BSD-3-Clause）、OpenAI Spinning Up（MIT）、etcd 文档（CC BY 4.0）、Cypress（MIT）、PostgreSQL（PostgreSQL）、Python（PSF-2.0）、MDN 正文（CC BY-SA 2.5）、Hugging Face Transformers（Apache-2.0）和 CleverHans（MIT）。完整来源、作者与目录映射见 [数据许可](DATA-LICENSE.md#其他官方参考文档)，每个 `data/primary-sources/` 子目录保留原许可和署名文件。这些资料仅用于来源核对，不作为插件运行依赖。

真实网页测试快照仅在本机 ignored artifacts 中保存，不作为插件或源码发布包内容：Mathematics in Lean、arXiv 论文 HTML、Python 官方文档的权利属于各自作者或机构。

项目代码许可：[MIT](LICENSE)。数据声明：[数据许可](DATA-LICENSE.md)。

公开性能测试语料的来源、公共领域状态及署名单独列于 [数据许可](DATA-LICENSE.md#公开测试语料)。NASA 内容仅作为有出处的教育测试引用，AM 模型译文不属于 NASA 官方内容。
