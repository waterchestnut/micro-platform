import React from 'react'
import {IconProps} from './types'

export const DoubleLeftIcon = (
  {
    size = 24,
    strokeWidth = 1,
    primaryColor = 'currentColor',
    className,
    title,
  }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox='64 64 896 896'
    fill={primaryColor}
    stroke={primaryColor}
    strokeWidth={strokeWidth}
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
    role='img'
    aria-label={title}
  >
    <path
      d='M272.9 512l265.4-339.1c4.1-5.2.4-12.9-6.3-12.9h-77.3c-4.9 0-9.6 2.3-12.6 6.1L186.8 492.3a31.99 31.99 0 000 39.5l255.3 326.1c3 3.9 7.7 6.1 12.6 6.1H532c6.7 0 10.4-7.7 6.3-12.9L272.9 512zm304 0l265.4-339.1c4.1-5.2.4-12.9-6.3-12.9h-77.3c-4.9 0-9.6 2.3-12.6 6.1L490.8 492.3a31.99 31.99 0 000 39.5l255.3 326.1c3 3.9 7.7 6.1 12.6 6.1H836c6.7 0 10.4-7.7 6.3-12.9L576.9 512z'/>
  </svg>
)

export function getDoubleLeftIconHtml(props: IconProps = {}) {
  const {
    size = 24,
    strokeWidth = 1,
    primaryColor = 'currentColor',
    className,
    title,
  } = props
  return `<svg
                width='${size}'
                height='${size}'
                viewBox='64 64 896 896'
                fill='${primaryColor}'
                stroke='${primaryColor}'
                stroke-width=${strokeWidth}
                stroke-linecap='round'
                stroke-linejoin='round'
                role='img'
                class='${className}'
                aria-label='${title}'
            >
                <path
      d='M272.9 512l265.4-339.1c4.1-5.2.4-12.9-6.3-12.9h-77.3c-4.9 0-9.6 2.3-12.6 6.1L186.8 492.3a31.99 31.99 0 000 39.5l255.3 326.1c3 3.9 7.7 6.1 12.6 6.1H532c6.7 0 10.4-7.7 6.3-12.9L272.9 512zm304 0l265.4-339.1c4.1-5.2.4-12.9-6.3-12.9h-77.3c-4.9 0-9.6 2.3-12.6 6.1L490.8 492.3a31.99 31.99 0 000 39.5l255.3 326.1c3 3.9 7.7 6.1 12.6 6.1H836c6.7 0 10.4-7.7 6.3-12.9L576.9 512z'/>
            </svg>`
}
