/**
 * rename all js files in current directory to have a .ts extension
 * make some transformations on the files eg convert vars to const
 */
import {resolve} from 'path';
import {replace, match} from 'ramda';
import * as lebab from 'lebab';
import * as yargs from 'yargs';
import {readdir, readFile, writeFile, unlink } from 'fs-extra';

const currentDir = process.cwd();

const codeTransforms =
    [   'let', 'arrow', 'commonjs', 'template',
        'destruct-param', 'includes', 'obj-shorthand',
        'no-strict', 'multi-var'
    ];

const allJsFilesInDir = async (dir: string): Promise<string[]> =>
    (await readdir(dir))
    .filter(fileName => match(/\.js$/, fileName).length);

export const newTsPath = (jsPath: string) =>
    jsPath.replace(/\.js$/, '.ts');

export const extraTransforms = (content: string) => {
    return replace(/exports\./gm, '', (content));
};

export const convertToTs = async (relativeDir?: string) => {
    const dir = relativeDir ? resolve(currentDir, relativeDir) : currentDir;
    console.info('converting files in ', dir);
    const allFiles = await allJsFilesInDir(dir);
    allFiles
        .forEach(async (fileName) => {
            const jsFullPath = resolve(dir, fileName);
            const content = await readFile(jsFullPath, 'utf8');
            const {code, warnings} = lebab.transform(content, codeTransforms);
            console.log('\n ** warnings ***', warnings, '*** \n');
            const tsPath = newTsPath(jsFullPath);
            await writeFile(tsPath, extraTransforms(code));
        });
};

export const cleanup =  async (relativeDir: string = currentDir) => {
    const dir = relativeDir ? resolve(currentDir, relativeDir) : currentDir;
    console.info('deleting files in ', dir);
    const allFiles = await allJsFilesInDir(dir);
    allFiles
        .forEach(async (fileName) => {
            const jsFullPath = resolve(dir, fileName);
            unlink(jsFullPath);
        });
};

const main = async () => {
    try {
        if (yargs.argv.d && yargs.argv.dir) return cleanup(yargs.argv.dir);
        if (yargs.argv.d) return cleanup();
        if (yargs.argv.dir) return convertToTs(yargs.argv.dir);
        return convertToTs();
     } catch (err) {
         console.error(err);
     }
};

if (process.env.NODE_ENV !== 'test') {
    main();
}
