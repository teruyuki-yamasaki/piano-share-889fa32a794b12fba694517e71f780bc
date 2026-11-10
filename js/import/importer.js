export class ImporterRegistry {
    importers = [];
    register(imp) {
        this.importers.push(imp);
        return this;
    }
    get acceptAttribute() {
        return this.importers.flatMap((i) => i.extensions.map((e) => `.${e}`)).join(',');
    }
    find(name) {
        const ext = name.toLowerCase().split('.').pop() ?? '';
        return this.importers.find((i) => i.extensions.includes(ext));
    }
    async import(src, onProgress) {
        const imp = this.find(src.name);
        if (!imp)
            throw new Error(`対応していないファイル形式です: ${src.name}`);
        return imp.import(src, { registry: this, onProgress });
    }
}
