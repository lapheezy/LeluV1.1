import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

function resolveIncludes(
  source: string,
  filePath: string,
): string {

  return source.replace(

    /^[ \t]*#include\s+"(.+?)"[ \t]*$/gm,

    (_match, includePath: string) => {

      const absolutePath = path.resolve(
        path.dirname(filePath),
        includePath,
      );

      if (!fs.existsSync(absolutePath)) {

        throw new Error(
          `GLSL include not found: ${absolutePath}`,
        );

      }

      const includeSource = fs.readFileSync(
        absolutePath,
        "utf8",
      );

      return resolveIncludes(
        includeSource,
        absolutePath,
      );

    },

  );

}

export default function glslIncludes(): Plugin {

  return {

    name: "glsl-includes",

    enforce: "pre",

    transform(
      code,
      id,
    ) {

      if (

        !id.endsWith(".glsl")

      ) {

        return null;

      }

      return {

        code: resolveIncludes(
          code,
          id,
        ),

        map: null,

      };

    },

  };

}