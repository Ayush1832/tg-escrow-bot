"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.findOnlyOnFirst = exports.findIntersection = void 0;
function findIntersection(arr1, arr2) {
    return arr1.filter(value => arr2.includes(value));
}
exports.findIntersection = findIntersection;
function findOnlyOnFirst(arr1, arr2) {
    return arr1.filter(value => !arr2.includes(value));
}
exports.findOnlyOnFirst = findOnlyOnFirst;
