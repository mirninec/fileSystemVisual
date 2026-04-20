import * as fs from 'fs';
import * as path from 'path';

/**
 * Опции стилизации узлов для графа
 */
interface NodeStyleOptions {
    color: string
    shape: string
    height: number
    style: string
}

/**
 * Высота узла для файлов
 */
const FILE_NODE_HEIGHT = 0.3;
/**
 * Высота узла для папок (в 1.5 раза больше файлов)
 */
const FOLDER_NODE_HEIGHT = FILE_NODE_HEIGHT * 1.5;

/**
 * Стилизация узла для файлов
 */
const FILE_NODE_STYLE: NodeStyleOptions = {
    color: 'lightblue',
    shape: 'box',
    height: FILE_NODE_HEIGHT,
    style: 'filled,rounded'
}

/**
 * Стилизация узла для папок
 */
const FOLDER_NODE_STYLE: NodeStyleOptions = {
    color: 'lightyellow',
    shape: 'folder',
    height: FOLDER_NODE_HEIGHT,
    style: 'filled'
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
 * Маппинг расширений файлов на цвета заливки узла.
 * Ключ — расширение (или составное расширение) без точки.
 * Порядок важен: составные расширения (spec.ts) проверяются первыми.
 */
const EXTENSION_COLORS: Record<string, string> = {
    'spec.ts': '#f4cccc',   // красноватый   — тесты
    'ts': '#cfe2f3',   // голубой       — TypeScript
    'js': '#fff2cc',   // жёлтый        — JavaScript
    'html': '#fce5cd',   // оранжевый     — HTML
    'css': '#d9ead3',   // зелёный       — CSS
    'scss': '#b6d7a8',   // тёмно-зелёный — SCSS
    'json': '#ead1dc',   // розовый       — JSON
    'md': '#e8d5b7',   // бежевый       — Markdown
}

/**
 * Цвет по умолчанию для файлов с неизвестным расширением.
 */
const DEFAULT_FILE_COLOR = 'lightblue';

/**
 * Определяет цвет заливки узла по имени файла.
 * Сначала проверяет составные расширения (например, spec.ts),
 * затем простые (ts, js, ...).
 * Если расширение не найдено — возвращает цвет по умолчанию.
 *
 * @param {string} filename - Имя файла.
 * @returns {string} Цвет заливки в формате, понятном Graphviz.
 *
 * @example
 * getFileColor('app.component.spec.ts') // => '#f4cccc'
 * getFileColor('main.ts')               // => '#cfe2f3'
 * getFileColor('styles.css')            // => '#d9ead3'
 * getFileColor('README.md')             // => '#e8d5b7'
 * getFileColor('Makefile')              // => 'lightblue'
 */
function getFileColor(filename: string): string {
    const lowerName = filename.toLowerCase();

    // Сортируем по убыванию длины, чтобы составные расширения
    // (spec.ts) имели приоритет над простыми (ts)
    const sortedExtensions = Object.keys(EXTENSION_COLORS)
        .sort((a, b) => b.length - a.length);

    for (const ext of sortedExtensions) {
        if (lowerName.endsWith(`.${ext}`)) {
            return EXTENSION_COLORS[ext];
        }
    }

    return DEFAULT_FILE_COLOR;
}

/**
 * Вычисляет ширину узла графа на основе длины отображаемого текста.
 * Убирает служебные символы \l перед подсчётом длины.
 *
 * @param {string} label - Текст метки узла (может содержать \l).
 * @param {number} minWidth - Минимальная ширина узла в дюймах.
 * @returns {number} Ширина узла в дюймах.
 */
function calcNodeWidth(label: string, minWidth: number = 2): number {
    const CHAR_WIDTH_INCHES = 0.11;
    const PADDING_INCHES = 0.3;

    // Убираем служебные символы \l и считаем длину самой длинной строки
    const cleanLabel = label.replace(/\\l/g, '\n'); // Заменяем экранированные \l на настоящие переводы строк
    const lines = cleanLabel.split('\n').map(l => l.trim()).filter(l => l.length > 0); // Разбиваем по строкам, удаляем лишние пробелы и пустые строки
    const maxLength = Math.max(...lines.map(line => line.length)); // Находим длину самой длинной строки

    const computed = maxLength * CHAR_WIDTH_INCHES + PADDING_INCHES;
    return Math.max(minWidth, computed);
}


/**
 * Основная функция программы. Строит граф файловой системы в формате DOT.
 */
function main(): void {
    const args: string[] = process.argv.slice(2);

    // Определяем, передан ли флаг --cut
    const shouldCut: boolean = args.includes('--cut');

    // Целевая директория — первый аргумент, не являющийся флагом
    const dirArg: string | undefined = args.find(arg => !arg.startsWith('--'));
    let targetDirectory: string = dirArg || process.cwd();

    // Выбираем функцию форматирования имён в зависимости от флага --cut
    const nameFormatter: NameFormatterFn = shouldCut ? truncateName : identityName;

    let currentDir: string = nameFormatter(path.basename(targetDirectory), 18);
    process.chdir(targetDirectory);
    console.log(targetDirectory);

    let dotContent: string[] = [
        `digraph FileSystem {
        rankdir = TB;
        ranksep = 0.2;
        nodesep = 0.2;
        edge [arrowhead = none];
        node [ fontname = "monospace"; width = 2; height = 0.4; style = "filled"; fillcolor = "lightyellow";]; 
        `
    ];

    let directoryEntries: string[] = fs.readdirSync(targetDirectory);

    if (directoryEntries.length === 0) {
        dotContent.push(`
    "trunk0" [label="папка
пуста";shape="folder";rank="min";];
}`);
        const emptyDirFilePath = path.resolve('fileSystemVisual.dot');
        fs.writeFileSync('fileSystemVisual.dot', dotContent.join(' '));
        console.log(`✅ Результирующий файл сохранён по пути: ${emptyDirFilePath}`);
        console.log('Используйте Graphviz для визуализации:dot - Tpng fileSystemVisual.dot - o diagram.png');
        return;
    }

    dotContent.push(`
    "0-0" [label="./${currentDir}";width = 2.5; shape="folder";rank="min";];
`);

    const initialPosition: NodePosition = {
        hierarchyLevel: 1,
        depthLevel: 0,
        lastFolder: false
    };

    createGraph(initialPosition, targetDirectory, dotContent, nameFormatter);
    dotContent.push(`
}`);

    const outputFilePath = path.resolve('fileSystemVisual.dot');
    fs.writeFileSync('./fileSystemVisual.dot', dotContent.join(''));
    console.log(`
✅ Результирующий файл сохранён по пути: ${outputFilePath}`);
    console.log('Используйте Graphviz для визуализации:dot - Tpng fileSystemVisual.dot - o diagram.png');
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
): void {
    const directoryEntries = safeReadDirSync(targetDirectory);
    for (let i = 0; i < directoryEntries.length; i++) {
        const isLast = (i === directoryEntries.length - 1);
        // Помечаем текущий уровень глубины как активный,
        // если это НЕ последний элемент на этом уровне
        activeDepthLevels[initialPosition.depthLevel] = !isLast;
        createSubGraph(initialPosition, directoryEntries[i], dotContent, nameFormatter);
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
): void {
    const isDir = fs.lstatSync(name).isDirectory();
    const currentDir = process.cwd();
    if (isDir) {
        createLine(initialPosition, name, dotContent, FOLDER_NODE_STYLE, nameFormatter);
        initialPosition.depthLevel++;
        initialPosition.hierarchyLevel++;
        process.chdir(name);
        createGraph(initialPosition, process.cwd(), dotContent, nameFormatter);
        --initialPosition.depthLevel;
    } else {
        // Динамически определяем цвет по расширению файла
        const fileStyle: NodeStyleOptions = {
            shape: FILE_NODE_STYLE.shape,
            color: getFileColor(name),
            height: FILE_NODE_HEIGHT,
            style: FILE_NODE_STYLE.style
        };
        createLine(initialPosition, name, dotContent, fileStyle, nameFormatter);
        initialPosition.hierarchyLevel++;
    }
    process.chdir(currentDir);
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
): void {
    let hierarchyLevel = initialPosition.hierarchyLevel;
    let depthLevel = initialPosition.depthLevel;

    const rootPoint = `"${--hierarchyLevel}-${depthLevel}"`;
    const rootDownPoint = `"${++hierarchyLevel}-${depthLevel}"`;
    const nodePoint = `"${hierarchyLevel}-${depthLevel + 1}"`;

    const verticalEdge = `${rootPoint} -> ${rootDownPoint}`;
    const gorizontEdge = `${rootDownPoint} -> ${nodePoint}`;

    createHelpPoints(initialPosition, dotContent);

    const label = formatNodeLabel(name, nameFormatter);
    const nodeWidth = calcNodeWidth(label);

    dotContent.push(`
${commentSeparator(name, 90)}
    ${rootPoint}; ${rootDownPoint}; ${nodePoint}; ${verticalEdge}; ${gorizontEdge};

    subgraph "${initialPosition.hierarchyLevel}-${initialPosition.depthLevel}" {
    rank=same;
    ${rootDownPoint} ${CONNECTOR_STYLE}
    ${nodePoint} [label="${label}", shape=${options.shape}, height=${options.height}, width=${nodeWidth.toFixed(2)}, style="${options.style}", fillcolor="${options.color}"];    }
        `);
}


/**
 * Создает вспомогательные точки в графе для выравнивания узлов.
 *
 * @param {NodePosition} initialPosition - Позиция узла в иерархии.
 * @param {string[]} dotContent - Массив строк, содержащий код графа в формате DOT.
 */
function createHelpPoints(
    initialPosition: { hierarchyLevel: number, depthLevel: number },
    dotContent: string[]
): void {
    if (initialPosition.depthLevel === 0) return;
    for (let d = 0; d < initialPosition.depthLevel; d++) {
        if (!activeDepthLevels[d]) continue;
        let localLevel = initialPosition.hierarchyLevel;
        let localDept = d;
        let helpPoint = `${localLevel - 1}-${localDept}`;
        let helpPointDown = `${localLevel}-${localDept}`;
        dotContent.push(`
    "${helpPointDown}"  ${CONNECTOR_STYLE}
    "${helpPoint}" -> "${helpPointDown}"; 
            `);
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
 * Форматирует метку узла графа.
 * Выравнивание по левому краю достигается суффиксом \l —
 * в DOT-формате \l означает перенос строки с выравниванием влево.
 *
 * @param {string} name - Имя файла или папки.
 * @param {NameFormatterFn} nameShorterFnc - Функция для сокращения имени.
 * @returns {string} Отформатированная метка для узла графа.
 *
 * @example
 * formatNodeLabel("MyFolder", identityName) // => "MyFolder\l(5)\l"
 * formatNodeLabel("main.ts", identityName)  // => "main.ts\l"
 */
function formatNodeLabel(
    name: string,
    nameShorterFnc: NameFormatterFn
): string {
    const shortedName = nameShorterFnc(name, 16);
    if (fs.lstatSync(name).isDirectory()) {
        const filesCount = fs.readdirSync(name).length;
        return `${shortedName}(${filesCount})`;
    } else {
        return `${shortedName}\\l`;
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
