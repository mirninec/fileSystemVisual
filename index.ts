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
 * Позиция узла в графе
 */
interface NodePosition {
    hierarchyLevel: number
    depthLevel: number
    lastFolder?: boolean
}

/**
 * Конфигурация исключений
 */
interface IgnoreOptions {
    patterns: string[];
    enabled: boolean;
}

/**
 * Тип функции для обработки имени узла.
 * Принимает имя и максимальную длину, возвращает строку.
 */
type NameFormatterFn = (name: string, length: number) => string;

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
 */
function getFileColor(filename: string): string {
    const lowerName = filename.toLowerCase();

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
 */
function calcNodeWidth(label: string, minWidth: number = 2): number {
    const CHAR_WIDTH_INCHES = 0.11;
    const PADDING_INCHES = 0.3;

    const cleanLabel = label.replace(/\\l/g, '\n');
    const lines = cleanLabel.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    const maxLength = Math.max(...lines.map(line => line.length));

    const computed = maxLength * CHAR_WIDTH_INCHES + PADDING_INCHES;
    return Math.max(minWidth, computed);
}

/**
 * Проверяет, нужно ли исключить элемент
 */
function shouldIgnoreItem(name: string, ignoreConfig: IgnoreOptions): boolean {
    if (!ignoreConfig.enabled) return false;
    
    for (const pattern of ignoreConfig.patterns) {
        if (pattern.includes('*')) {
            const regexPattern = pattern
                .replace(/\./g, '\\.')
                .replace(/\*/g, '.*');
            const regex = new RegExp(`^${regexPattern}$`);
            if (regex.test(name)) return true;
        } else if (name === pattern) {
            return true;
        }
    }
    return false;
}

/**
 * Фильтрует исключаемые элементы
 */
function filterIgnoredEntries(entries: string[], ignoreConfig: IgnoreOptions): string[] {
    if (!ignoreConfig.enabled) return entries;
    
    return entries.filter(entry => !shouldIgnoreItem(entry, ignoreConfig));
}

/**
 * Безопасно читает содержимое директории.
 */
function safeReadDirSync(directory: string): string[] {
    try {
        return fs.readdirSync(directory);
    } catch (error) {
        console.error(`Ошибка при чтении директории ${directory}:`, error);
        return [];
    }
}

/**
 * Обрезает длинное имя до указанной длины, добавляя многоточие в середине.
 */
function truncateName(name: string, length: number): string {
    if (name.length <= length) return name;
    const partLength = Math.floor((length - 3) / 2);
    return `${name.slice(0, partLength)}...${name.slice(-partLength)}`;
}

/**
 * Возвращает имя без изменений.
 */
function identityName(name: string, _length: number): string {
    return name;
}

/**
 * Форматирует метку узла графа.
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
 * Создает строку-разделитель для комментариев.
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
 * Создает вспомогательные точки в графе для выравнивания узлов.
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
 * Создает строку, представляющую узел и связи для графа.
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
 * Создает подграф для отдельного элемента (файл или папка).
 */
function createSubGraph(
    initialPosition: { hierarchyLevel: number, depthLevel: number },
    name: string,
    dotContent: string[],
    nameFormatter: NameFormatterFn,
    ignoreConfig: IgnoreOptions
): void {
    // Проверяем, нужно ли исключить этот элемент
    if (shouldIgnoreItem(name, ignoreConfig)) {
        return;
    }
    
    const isDir = fs.lstatSync(name).isDirectory();
    const currentDir = process.cwd();
    if (isDir) {
        createLine(initialPosition, name, dotContent, FOLDER_NODE_STYLE, nameFormatter);
        initialPosition.depthLevel++;
        initialPosition.hierarchyLevel++;
        process.chdir(name);
        createGraph(initialPosition, process.cwd(), dotContent, nameFormatter, ignoreConfig);
        --initialPosition.depthLevel;
    } else {
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
 * Рекурсивно строит граф файловой системы.
 */
function createGraph(
    initialPosition: { hierarchyLevel: number, depthLevel: number },
    targetDirectory: string,
    dotContent: string[],
    nameFormatter: NameFormatterFn,
    ignoreConfig: IgnoreOptions
): void {
    let directoryEntries = safeReadDirSync(targetDirectory);
    
    directoryEntries = filterIgnoredEntries(directoryEntries, ignoreConfig);
    
    for (let i = 0; i < directoryEntries.length; i++) {
        const isLast = (i === directoryEntries.length - 1);
        activeDepthLevels[initialPosition.depthLevel] = !isLast;
        createSubGraph(initialPosition, directoryEntries[i], dotContent, nameFormatter, ignoreConfig);
    }
}

/**
 * Основная функция программы.
 */
function main(): void {
    const args: string[] = process.argv.slice(2);

    const shouldCut: boolean = args.includes('--cut');
    
    let ignorePatterns: string[] = [];
    let ignoreEnabled = false;
    
    // Обработка флагов исключения
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '-I' || args[i] === '--ignore') {
            if (i + 1 < args.length) {
                const patterns = args[i + 1].split(',').map(p => p.trim());
                ignorePatterns.push(...patterns);
                ignoreEnabled = true;
                args.splice(i, 2);
                i--;
            }
        }
    }

    const dirArg: string | undefined = args.find(arg => !arg.startsWith('--'));
    let targetDirectory: string = dirArg || process.cwd();

    const nameFormatter: NameFormatterFn = shouldCut ? truncateName : identityName;
    
    const ignoreConfig: IgnoreOptions = {
        patterns: ignorePatterns,
        enabled: ignoreEnabled
    };

    let currentDir: string = nameFormatter(path.basename(targetDirectory), 18);
    process.chdir(targetDirectory);
    console.log(targetDirectory);
    if (ignoreEnabled) {
        console.log(`Исключаемые паттерны: ${ignorePatterns.join(', ')}`);
    }

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
    
    directoryEntries = filterIgnoredEntries(directoryEntries, ignoreConfig);

    if (directoryEntries.length === 0) {
        dotContent.push(`
    "trunk0" [label="папка
пуста";shape="folder";rank="min";];
}`);
        const emptyDirFilePath = path.resolve('fileSystemVisual.dot');
        fs.writeFileSync('fileSystemVisual.dot', dotContent.join(' '));
        console.log(`✅ Результирующий файл сохранён по пути: ${emptyDirFilePath}`);
        console.log('Используйте Graphviz для визуализации: dot -Tpng fileSystemVisual.dot -o diagram.png');
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

    createGraph(initialPosition, targetDirectory, dotContent, nameFormatter, ignoreConfig);
    dotContent.push(`
}`);

    const outputFilePath = path.resolve('fileSystemVisual.dot');
    fs.writeFileSync('./fileSystemVisual.dot', dotContent.join(''));
    console.log(`
✅ Результирующий файл сохранён по пути: ${outputFilePath}`);
    console.log('Используйте Graphviz для визуализации: dot -Tpng fileSystemVisual.dot -o diagram.png');
}

main();
