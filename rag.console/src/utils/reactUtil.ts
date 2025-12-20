/**
 * @fileOverview react相关的工具
 * @author xianyang 2024/6/19
 * @module
 */

import {useRef, useState} from "react";

export function useStateAndRef(initial: any) {
  const [value, setValue] = useState(initial);
  const valueRef = useRef(value);
  valueRef.current = value;
  return [value, setValue, valueRef];
}
