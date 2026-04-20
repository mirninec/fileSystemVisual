import * as fs from 'fs';
import * as path from 'path';

/**
 * Опции стилизации узлов для графа
 */
interface NodeStyleOptions {
    color: string
    shape: string
}

/**
 * Стилизация узла для файлов
 */
const FILE_NODE_STYLE = {
    color: 'lightblue',
    shape: 'box'
}

/**
 * Стилизация узла для папок
 */
const FOLDER_NODE_STYLE = {
    color: 'lightyellow',
    shape: 'folder'
}

/**
 * Позиция узла в графе
 */
interface NodePosition {
    hierarchyLevel: number
    depthLevel: number
    lastFolder?: boolean
}

/**
 * Массив, отслеживающий активные (незакрытые) уровни глубины.
 * Если activeDepthLevels[d] === true, значит на глубине d ещё есть
 * элементы для отображения и нужно тянуть вертикальную линию.
 */
const activeDepthLevels: boolean[] = [];

/**
 * Стиль соединительных элементов в графе
 */
const CONNECTOR_STYLE = '[shape=point; width=0.03; style="filled"; fillcolor="black"];'

/**
 * Тип функции для обработки имени узла.
 * Принимает имя и максимальную длину, возвращает строку.
 */
type NameFormatterFn = (name: string, length: number) => string;

/**
 * Основная функция программы. Строит граф файловой системы в формате DOT.
 */
function main(): void {
    // Аргументы командной строки (без первых двух служебных)
    const args: string[] = process.argv.slice(2);

    // Определяем, передан ли флаг --cut
    const shouldCut: boolean = args.includes('--cut');

    // Целевая директория — первый аргумент, не являющийся флагом
    const dirArg: string | undefined = args.find(arg => !arg.startsWith('--'));
    let targetDirectory: string = dirArg || process.cwd();

    // Выбираем функцию форматирования имён в зависимости от флага --cut
    const nameFormatter: NameFormatterFn = shouldCut ? truncateName : identityName;

    let currentDir: string = nameFormatter(path.basename(targetDirectory), 18);
    process.chdir(targetDirectory)
    console.log(targetDirectory)
    let dotContent: string[] = [
        `digraph FileSystem {
    rankdir = TB;
    edge [arrowhead = none];
    node [ fontname = "monospace"; width = 2; height = 0.75; style = "filled"; fillcolor = "lightyellow";]; 
    `
    ];
    let directoryEntries: string[] = fs.readdirSync(targetDirectory);
    if (directoryEntries.length === 0) {
        dotContent.push(`
    "trunk0" [label="папка\
пуста";shape="folder";rank="min";];
}`);
        const emptyDirFilePath = path.resolve('fileSystemVisual.dot');
        fs.writeFileSync('fileSystemVisual.dot', dotContent.join('
'));
        console.log(`
✅ Результирующий файл сохранён по пути: ${emptyDirFilePath}`);
        console.log('Используйте Graphviz для визуализации:

dot -Tpng fileSystemVisual.dot -o diagram.png
');
        return;
    }
    dotContent.push(`
    "0-0" [label="./${currentDir}";width = 2.5; shape="folder";rank="min";];
`);
    const initialPosition: NodePosition = {
        hierarchyLevel: 1,
        depthLevel: 0,
        lastFolder: false
    }
    createGraph(initialPosition, targetDirectory, dotContent, nameFormatter)
    dotContent.push(`
}`);
    const outputFilePath = path.resolve('fileSystemVisual.dot');
    fs.writeFileSync('./fileSystemVisual.dot', dotContent.join(''));
    console.log(`
✅ Результирующий файл сохранён по пути: ${outputFilePath}`);
    console.log('Используйте Graphviz для визуализации:

dot -Tpng fileSystemVisual.dot -o diagram.png
');
}

/**
 * Рекурсивно строит граф файловой системы.
 * @param initialPosition - Текущая позиция узла.
 * @param targetDirectory - Путь к целевой директории.
 * @param dotContent - Массив строк для содержимого DOT-файла.
 * @param nameFormatter - Функция форматирования имён узлов.
 */
function createGraph(
    initialPosition: { hierarchyLevel: number, depthLevel: number },
    targetDirectory: string,
    dotContent: string[],
    nameFormatter: NameFormatterFn
) {
    const directoryEntries = safeReadDirSync(targetDirectory);
    for (let i = 0; i < directoryEntries.length; i++) {
        const isLast = (i === directoryEntries.length - 1);
        // Помечаем текущий уровень глубины как активный,
        // если это НЕ последний элемент на этом уровне
        activeDepthLevels[initialPosition.depthLevel] = !isLast;
        createSubGraph(initialPosition, directoryEntries[i], dotContent, nameFormatter)
    }
}

/**
 * Создает подграф для отдельного элемента (файл или папка).
 * @param initialPosition - Текущая позиция узла.
 * @param name - Имя элемента.
 * @param dotContent - Массив строк для содержимого DOT-файла.
 * @param nameFormatter - Функция форматирования имён узлов.
 */
function createSubGraph(
    initialPosition: { hierarchyLevel: number, depthLevel: number },
    name: string,
    dotContent: string[],
    nameFormatter: NameFormatterFn
) {
    const isDir = fs.lstatSync(name).isDirectory()
    const currentDir = process.cwd()
    if (isDir) {
        createLine(initialPosition, name, dotContent, FOLDER_NODE_STYLE, nameFormatter)
        initialPosition.depthLevel++
        initialPosition.hierarchyLevel++
        process.chdir(name)
        createGraph(initialPosition, process.cwd(), dotContent, nameFormatter)
        --initialPosition.depthLevel
    } else {
        createLine(initialPosition, name, dotContent, FILE_NODE_STYLE, nameFormatter)
        initialPosition.hierarchyLevel++
    }
    process.chdir(currentDir)
}

/**
 * Создает строку, представляющую узел и связи для графа.
 * @param initialPosition - Текущая позиция узла.
 * @param name - Имя элемента.
 * @param dotContent - Массив строк для содержимого DOT-файла.
 * @param options - Опции стилизации узла.
 * @param nameFormatter - Функция форматирования имён узлов.
 */
function createLine(
    initialPosition: { hierarchyLevel: number, depthLevel: number },
    name: string,
    dotContent: string[],
    options: NodeStyleOptions,
    nameFormatter: NameFormatterFn
) {
    let hierarchyLevel = initialPosition.hierarchyLevel
    let depthLevel = initialPosition.depthLevel

    const rootPoint = `"${--hierarchyLevel}-${depthLevel}"`
    const rootDownPoint = `"${++hierarchyLevel}-${depthLevel}"`
    const nodePoint = `"${hierarchyLevel}-${depthLevel + 1}"`

    const verticalEdge = `${rootPoint} -> ${rootDownPoint}`
    const gorizontEdge = `${rootDownPoint} -> ${nodePoint}`

    createHelpPoints(initialPosition, dotContent)

    dotContent.push(`
${commentSeparator(name, 90)}
    ${rootPoint}; ${rootDownPoint}; ${nodePoint}; ${verticalEdge}; ${gorizontEdge};

    subgraph "${initialPosition.hierarchyLevel}-${initialPosition.depthLevel}" {
    rank=same;
    ${rootDownPoint} ${CONNECTOR_STYLE}
    ${nodePoint} [label="${formatNodeLabel(name, nameFormatter)}",shape=${options.shape}, height=0.4, style=filled, fillcolor=${options.color}];
    }
        `)
}

/**
 * Создает вспомогательные точки в графе для выравнивания узлов.
 * 
 * @param {NodePosition} initialPosition - Позиция узла в иерархии.
 * @param {string[]} dotContent - Массив строк, содержащий код графа в формате DOT.
 */
function createHelpPoints(initialPosition: { hierarchyLevel: number, depthLevel: number }, dotContent: string[]) {
    if (initialPosition.depthLevel === 0) return
    for (let d = 0; d < initialPosition.depthLevel; d++) {
        // Пропускаем уровни, на которых больше нет элементов
        if (!activeDepthLevels[d]) continue;
        let localLevel = initialPosition.hierarchyLevel
        let localDept = d
        let helpPoint = `${localLevel - 1}-${localDept}`
        let helpPointDown = `${localLevel}-${localDept}`
        dotContent.push(`
    "${helpPointDown}"  ${CONNECTOR_STYLE}
    "${helpPoint}" -> "${helpPointDown}"; 
            `)
    }
}

/**
 * Обрезает длинное имя до указанной длины, добавляя многоточие в середине.
 * 
 * @param {string} name - Исходное имя файла или папки.
 * @param {number} length - Максимально допустимая длина строки.
 * @returns {string} Усеченное имя с многоточием в середине, если оно превышает допустимую длину.
 * 
 * @example
 * console.log(truncateName("VeryLongFileName.txt", 10));
 * // Вывод: "Ver...txt"
 */
function truncateName(name: string, length: number): string {
    if (name.length <= length) return name;
    const partLength = Math.floor((length - 3) / 2);
    return `${name.slice(0, partLength)}...${name.slice(-partLength)}`;
}

/**
 * Возвращает имя без изменений, игнорируя ограничение длины.
 * Используется по умолчанию, когда флаг --cut не передан.
 * 
 * @param {string} name - Исходное имя файла или папки.
 * @param {number} _length - Игнорируется.
 * @returns {string} Исходное имя без изменений.
 * 
 * @example
 * console.log(identityName("VeryLongFileName.txt", 10));
 * // Вывод: "VeryLongFileName.txt"
 */
function identityName(name: string, _length: number): string {
    return name;
}

/**
 * Форматирует метку узла графа, укорачивая имя и добавляя количество файлов в папке (если узел - папка).
 * 
 * @param {string} name - Имя файла или папки.
 * @param {NameFormatterFn} nameShorterFnc - Функция для сокращения имени.
 * @returns {string} Отформатированная метка для узла графа.
 * 
 * @example
 * console.log(formatNodeLabel("MyFolder", truncateName));
 * // Возможный вывод: "MyFo...er
(5)", если в папке 5 файлов
 */
function formatNodeLabel(
    name: string,
    nameShorterFnc: NameFormatterFn
): string {
    const shortedName = nameShorterFnc(name, 16);
    if (fs.lstatSync(name).isDirectory()) {
        const filesCount = fs.readdirSync(name).length;
        return `${shortedName}\
(${filesCount})`;
    } else {
        return shortedName;
    }
}

/**
 * Создает строку-разделитель для комментариев, содержащую имя файла в центре.
 * 
 * @param {string} filename - Имя файла, которое будет включено в комментарий.
 * @param {number} lineLength - Длина строки-разделителя.
 * @returns {string} Строка комментария с разделителем.
 * 
 * @example
 * console.log(commentSeparator("example.txt", 40));
 * // Вывод: "//========= example.txt =========//"
 */
function commentSeparator(filename: string, lineLength: number): string {
    const minimalValidLength = 4;
    const validatedLength = Math.max(lineLength, minimalValidLength);

    const maxNameLength = validatedLength - minimalValidLength;
    const trimmedName = filename.slice(0, maxNameLength);

    const availableSpace = validatedLength - trimmedName.length - minimalValidLength;
    const leftEquals = Math.floor(availableSpace / 2);
    const rightEquals = availableSpace - leftEquals;

    return `//${'='.repeat(leftEquals)} ${trimmedName} ${'='.repeat(rightEquals)}`;
}

/**
 * Безопасно читает содержимое директории.
 * @param directory - Путь к директории.
 * @returns Список файлов и папок.
 */
function safeReadDirSync(directory: string): string[] {
    try {
        return fs.readdirSync(directory);
    } catch (error) {
        console.error(`Ошибка при чтении директории ${directory}:`, error);
        return [];
    }
}

main();
