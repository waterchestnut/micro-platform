/**
 * @fileOverview 学校的班级
 */
import mongoose from 'mongoose';

const Schema = mongoose.Schema;

export default new Schema({
    classCode: {type: String, description: '行政班级标识'},
    className: {type: String, description: '班级名称'},
});