import { defineConfig } from 'wxt';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  hooks: {'build:manifestGenerated':(_wxt,manifest)=>{
    // Runtime registration should not turn optional website access into blanket install-time access.
    delete manifest.host_permissions;
    if(manifest.options_ui)manifest.options_ui.open_in_tab=true;
  }},
  manifest: {
    name: 'AM 学术翻译', description: '术语一致，公式完整。连接自己的 API 或本地模型，专注学术阅读。',
    minimum_chrome_version: '116',
    permissions: ['activeTab', 'scripting', 'storage', 'sidePanel', 'offscreen', 'contextMenus', 'declarativeNetRequestWithHostAccess'],
    optional_host_permissions: ['https://*/*', 'http://*/*'],
    action: { default_title: 'AM 学术翻译', default_popup: 'popup.html' },
    side_panel: { default_path: 'sidepanel.html' },
    icons: { '16': 'icon/16.png', '32': 'icon/32.png', '48': 'icon/48.png', '128': 'icon/128.png' },
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'self'; worker-src 'self';" },
  },
});
