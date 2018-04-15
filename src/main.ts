/**
 * rename all js files in current directory to have a .ts extension
 * make some transformations on the files eg convert vars to const
 */
import {resolve} from 'path';
import {replace, pipe, match} from 'ramda';
import * as lebab from 'lebab';
import {readdir, readFile, writeFile, unlink } from 'fs-extra';

const currentDir = process.cwd();

const codeTransforms =
    [   'let', 'arrow', 'for-of', 'commonjs', 'template',
        'destruct-param', 'includes', 'for-each', 'obj-shorthand',
        'no-strict', 'multi-var'
    ];

const allFileInDir = async (): Promise<string[]> =>
    readdir(currentDir);

export const newTsPath = (jsPath: string) =>
    jsPath.replace(/\.js$/, '.ts');

export const transformFile = (content: string) => {
    const transform = pipe(
              replace(/var/g, 'const') // first action
            , replace(/\n^exports\./gm, 'export const ')
            , replace(/exports\./gm, '')
        );
    return transform(content);
};

export const convertToTs = async () => {
    const allFiles = await allFileInDir();
    allFiles
        .filter(fileName => match(/\.js$/, fileName).length)
        .forEach(async (fileName) => {
            const jsFullPath = resolve(currentDir, fileName);
            const content = await readFile(jsFullPath, 'utf8');
            const {code, warnings} = lebab.transform(content, codeTransforms);
            console.log('\n ** warnings ***', warnings, '*** \n');
            // const newContent = transformFile(content);
            const tsPath = newTsPath(jsFullPath);
            // unlink(jsFullPath)
            await Promise.all([writeFile(tsPath, code)]);
        });
};

if (require.main === module && process.env.NODE_ENV !== 'test') {
    try {
       main();
    } catch (err) {
        console.error(err);
    }
}
