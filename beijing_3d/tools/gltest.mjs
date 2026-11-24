// Probe which WebGL backend headless Chromium gives us.
import { chromium } from 'playwright-core';
const variants = {
  'angle-vulkan': ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-gpu'],
  'angle-gl-egl': ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist', '--enable-gpu'],
  'default': ['--ignore-gpu-blocklist', '--enable-gpu'],
};
for (const [name, args] of Object.entries(variants)) {
  let browser;
  try {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: [...args, '--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto('about:blank');
    const info = await page.evaluate(() => {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2');
      if (!gl) return 'no webgl2';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER),
        maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE), samples: gl.getParameter(gl.MAX_SAMPLES),
        floatBuf: !!gl.getExtension('EXT_color_buffer_float'), halfBuf: !!gl.getExtension('EXT_color_buffer_half_float'),
        floatLinear: !!gl.getExtension('OES_texture_float_linear'), clipControl: !!gl.getExtension('EXT_clip_control'),
      };
    });
    console.log(name, JSON.stringify(info));
  } catch (e) { console.log(name, 'ERR', String(e).slice(0, 200)); }
  finally { if (browser) await browser.close(); }
}
