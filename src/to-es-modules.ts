/**
 * rename all js files in current directory to have a .ts extension
 * make some transformations on the files eg convert vars to const
 */
import {resolve} from 'path';
import {replace, match} from 'ramda';
import * as lebab from 'lebab';
import * as yargs from 'yargs';
import {readdir, readFile, writeFile} from 'fs-extra';

const currentDir = process.cwd();

const codeTransforms =
    [ 'let', 'commonjs' ];

const allJsFilesInDir = async (dir: string): Promise<string[]> =>
    (await readdir(dir))
    .filter(fileName => match(/\.js$/, fileName).length);

export const newTsPath = (jsPath: string) =>
    jsPath.replace(/\.js$/, '.ts');

export const extraTransforms = (content: string) => {
    return replace(/exports\./gm, '', (content));
};

export const convertToEs = async (relativeDir?: string) => {
    const dir = relativeDir ? resolve(currentDir, relativeDir) : currentDir;
    console.info('converting files in ', dir);
    const allFiles = await allJsFilesInDir(dir);
    allFiles
        .forEach(async (fileName) => {
            const jsFullPath = resolve(dir, fileName);
            const content = await readFile(jsFullPath, 'utf8');
            const {code, warnings} = lebab.transform(content, codeTransforms);
            console.log('\n ** warnings ***', warnings, '*** \n');
            // const tsPath = newTsPath(jsFullPath);
            await writeFile(jsFullPath, extraTransforms(code));
        });
};

// export const cleanup =  async (relativeDir: string = currentDir) => {
//     const dir = relativeDir ? resolve(currentDir, relativeDir) : currentDir;
//     console.info('deleting files in ', dir);
//     const allFiles = await allJsFilesInDir(dir);
//     allFiles
//         .forEach(async (fileName) => {
//             const jsFullPath = resolve(dir, fileName);
//             unlink(jsFullPath);
//         });
// };

const main = async () => {
    try {
        // if (yargs.argv.d && yargs.argv.dir) return cleanup(yargs.argv.dir);
        // if (yargs.argv.d) return cleanup();
        if (yargs.argv.dir) return convertToEs(yargs.argv.dir);
        return convertToEs();
     } catch (err) {
         console.error(err);
     }
};

if (process.env.NODE_ENV !== 'test') {
    main();
}
