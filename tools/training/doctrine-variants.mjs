import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { DOCTRINE_PARAMETER_RANGES, createDoctrineVariant } from '../../src/data/doctrines.js';
import { neuralRulesId } from '../../src/ai/neuralRules.js';

export function createDoctrineCatalog() {
    const variants = [];
    for (const [base, ranges] of Object.entries(DOCTRINE_PARAMETER_RANGES)) {
        variants.push(createDoctrineVariant(base));
        for (const [parameter, [minimum, maximum, original]] of Object.entries(ranges)) {
            for (let value = minimum; value <= maximum; value++) {
                if (value !== original) variants.push(createDoctrineVariant(base, { [parameter]: value }));
            }
        }
    }
    return { format: 'naval-doctrine-catalog-v1', baseRulesId: neuralRulesId(),
        rulesId: neuralRulesId({ doctrineVariants: true }), generation: 'single-parameter-neighborhood-v1', variants };
}

export function validateDoctrineCatalog(catalog) {
    if (catalog?.format !== 'naval-doctrine-catalog-v1' || catalog.baseRulesId !== neuralRulesId()
        || catalog.rulesId !== neuralRulesId({ doctrineVariants: true }) || !Array.isArray(catalog.variants)) {
        throw new Error('学说变体目录的协议或规则范围不一致');
    }
    const variants = catalog.variants.map(variant => {
        if (variant?.format !== 'naval-doctrine-variant-v1'
            || Object.keys(variant).sort().join(',') !== 'base,format,parameters') throw new Error('学说变体目录包含无效描述');
        return createDoctrineVariant(variant.base, variant.parameters);
    });
    if (new Set(variants.map(variant => JSON.stringify(variant))).size !== variants.length) throw new Error('学说变体目录包含重复参数');
    const families = Object.fromEntries(Object.keys(DOCTRINE_PARAMETER_RANGES).map(base => [base, variants.filter(variant => variant.base === base)]));
    if (Object.values(families).some(items => items.length < 2 || !items.some(item => !Object.keys(item.parameters).length))) {
        throw new Error('学说变体目录须覆盖七原型及其参数变体');
    }
    return families;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (!process.argv[2]) throw new Error('用法：node tools/training/doctrine-variants.mjs <全新目录清单.json>');
    const catalog = process.argv[2] === '--validate' ? JSON.parse(fs.readFileSync(0, 'utf8')) : createDoctrineCatalog();
    validateDoctrineCatalog(catalog);
    if (process.argv[2] !== '--validate') fs.writeFileSync(process.argv[2], JSON.stringify(catalog, null, 2), { flag: 'wx' });
    console.log(JSON.stringify({ variants: catalog.variants.length, rulesId: catalog.rulesId, baseRulesId: catalog.baseRulesId }));
}
