import { compile, registerHelper, HelperDeclareSpec, RuntimeOptions } from 'handlebars';
import { resolve } from 'path';
import { readFile, FileHandle } from 'fs/promises';
import { IndexHtmlTransformContext, Plugin as VitePlugin, normalizePath } from 'vite';
import { Context, resolveContext } from './context';
import { registerPartials } from './partials';

type CompileArguments = Parameters<typeof compile>;
type CompileOptions = CompileArguments[1];

export interface HandlebarsPluginConfig {
  context?: Context;
  reloadOnPartialChange?: boolean;
  settingsFile: FileHandle;
  compileOptions?: CompileOptions;
  runtimeOptions?: RuntimeOptions;
  partialDirectory?: string | Array<string>;
  helpers?: HelperDeclareSpec;
}

export default function handlebars({
  reloadOnPartialChange = true,
  settingsFile,
  compileOptions,
  runtimeOptions,
  partialDirectory,
  helpers,
}: HandlebarsPluginConfig): VitePlugin {
  // Keep track of what partials are registered
  const partialsSet = new Set<string>();

  let root: string;

  registerHelper('resolve-from-root', function (path) {
    return resolve(root, path);
  });

  if (helpers) {
    registerHelper(helpers);
  }

  return {
    name: 'handlebars',

    configResolved(config) {
      root = config.root;
    },

    async handleHotUpdate({ server, file }) {
      if (reloadOnPartialChange && partialsSet.has(file)) {
        server.ws.send({
          type: 'full-reload',
        });

        return [];
      }
    },

    transformIndexHtml: {
      // Ensure Handlebars runs _before_ any bundling
      enforce: 'pre',

      async transform(html: string, ctx: IndexHtmlTransformContext): Promise<string> {
        if (partialDirectory) {
          await registerPartials(partialDirectory, partialsSet);
        }

        const template = compile(html, compileOptions);

        // Lets load in the glitch settings.json
        const settings = await readFile(settingsFile, 'utf-8');
        let json;
        try {
          json = JSON.parse(settings.toString());
        } catch (e) {
          // There is an error in the JSON! Display the last known working version
          // directly from the vite .cache
          json = async () => import('../settings.json');
        }

        const resolvedContext = await resolveContext({ settings: json }, normalizePath(ctx.path));
        const result = template(resolvedContext, runtimeOptions);

        return result;
      },
    },
  };
}
