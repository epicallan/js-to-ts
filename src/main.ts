/**
 * rename all js files in current directory to have a .ts extension
 * make some transformations on the files eg convert vars to const
 */
import {resolve} from 'path';
import {replace, pipe, match} from 'ramda';
import {readdir, rename, readFile, writeFile, unlink } from 'fs-extra';

const currentDir = process.cwd();

const allFileInDir = async (): Promise<string[]> =>
    readdir(currentDir);

export const newTsPath = (jsPath: string) =>
    jsPath.replace(/\.js$/, '.ts');

export const renameAllFiles = async (): Promise<string[]> => {
    const allFiles = await allFileInDir();
    const renameAction = allFiles
        .filter(fileName => match(/\.js$/, fileName).length)
        .map(async (oldPath) => {
            const newFileName = newTsPath(oldPath);
            await rename(oldPath, newFileName);
            return resolve(currentDir, newFileName);
        });
    return Promise.all(renameAction);
};

export const transformFile = (content: string) => {
    const transform = pipe(
              replace(/var/g, 'const') // first action
            , replace(/\n^exports\./gm, 'export const')
            , replace(/\n^exports\./gm, '')
        );
    return transform(content);
};

export const main = async () => {
    const allFiles = await allFileInDir();
    allFiles
        .filter(fileName => match(/\.js$/, fileName).length)
        .forEach(async (fileName) => {
            const jsFullPath = resolve(currentDir, fileName);
            const content = await readFile(jsFullPath, 'utf8');
            const newContent = transformFile(content);
            const newPathName = newTsPath(jsFullPath);
            Promise.all([writeFile(newContent, newPathName), unlink(jsFullPath)]);
        });
};

if (require.main === module && process.env.NODE_ENV !== 'test') {
    try {
       main();
    } catch (err) {
        console.error(err);
    }
}
