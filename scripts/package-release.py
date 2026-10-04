"""Package the already-built extension plus a clean source archive; never publish."""
from pathlib import Path
import hashlib,zipfile,json
root=Path(__file__).resolve().parent.parent
release=root/'release';release.mkdir(exist_ok=True)
manifest=json.loads((root/'.output/chrome-mv3/manifest.json').read_text())
assert not manifest.get('host_permissions'),'Release must not contain test grants'
assert manifest['manifest_version']==3
version=manifest['version']
index=json.loads((root/'public/glossaries/index.json').read_text())
core_count=sum(p['count'] for p in index['packs'] if p['group']=='core')
candidate_count=sum(p['count'] for p in index['packs'] if p['group']=='extended')
installer=release/f'AM-学术翻译-{version}.zip'
with zipfile.ZipFile(installer,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted((root/'.output/chrome-mv3').rglob('*')):
        if p.is_file() and p.name!='.DS_Store':z.write(p,p.relative_to(root/'.output/chrome-mv3'))
    z.writestr('安装说明.txt',f'''AM 学术翻译 {version}

1. 解压整个安装包。
2. Chrome 打开 chrome://extensions，开启开发者模式。
3. 加载已解压的扩展程序，选择含 manifest.json 的这个文件夹。
4. 插件设置中选择自己的模型连接。
   本地 Ollama 地址 http://localhost:11434，点击发现本地模型；
   免费云端可选智谱/硅基流动/OpenRouter，填写个人密钥、核实免费型号、测试后保存。
   极速和精准可分别指定已保存的模型。
5. 打开英文 HTML 网页，点击插件图标开始翻译。

已有用户：覆盖原先加载目录，扩展管理页点击重新加载，再刷新待译网页。
不要删除插件，无需重填原来的模型配置。

本地上下文默认 8K，可在设置页调整；低内存先用 4K–8K。
极速/精准档与学术/普通模式可以独立切换。
本地极速与精准均逐段显示，当前可见内容按阅读顺序翻译。
本地精准默认直接输出，保留上下文与术语；深度思考和译后校润可独立开启。
译后校润默认关闭；开启后先显示初译，再后台处理，提供校润本段。
连续两次校润结构失败暂停本篇自动校润；原译文保留。
免费预设仅使用核实的固定零价型号，额度不足暂停，绝不自动转付费。
免费价格清单30天有效，过期需重新核实；线上质量未实测。
术语图为默认关闭的消歧实验。升级无需重新配置模型。
词库覆盖数学、物理、计算机，支持手选和自动识别。
核心 {core_count:,} 条（项目编辑整理，待持续专业复核）；候选 {candidate_count:,} 条。
目前不支持 PDF、扫描件，未发布 Chrome 商店。
''')
source=release/f'AM-学术翻译-{version}-源码.zip'
files=['package.json','package-lock.json','tsconfig.json','wxt.config.ts','vitest.config.ts','playwright.config.ts','.gitignore','README.md','LICENSE','DATA-LICENSE.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md']
with zipfile.ZipFile(source,'w',zipfile.ZIP_DEFLATED) as z:
    for name in files:z.write(root/name,name)
    for name in ['src','entrypoints','scripts','public','data','tests','docs','templates','.github']:
        for p in sorted((root/name).rglob('*')):
            if p.is_file() and '__pycache__' not in p.parts and p.name!='.DS_Store' and p.suffix not in ['.log','.pyc']:z.write(p,p.relative_to(root))
for p in [installer,source]:
    with zipfile.ZipFile(p) as z:assert z.testzip() is None
    print(p.name,p.stat().st_size,'bytes')
(release/'SHA256SUMS.txt').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in [installer,source]))
