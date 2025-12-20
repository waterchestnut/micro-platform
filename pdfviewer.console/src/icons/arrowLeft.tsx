import React from 'react'
import {IconProps} from './types'

export const ArrowLeftIcon = (
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
      d='M872 474H286.9l350.2-304c5.6-4.9 2.2-14-5.2-14h-88.5c-3.9 0-7.6 1.4-10.5 3.9L155 487.8a31.96 31.96 0 000 48.3L535.1 866c1.5 1.3 3.3 2 5.2 2h91.5c7.4 0 10.8-9.2 5.2-14L286.9 550H872c4.4 0 8-3.6 8-8v-60c0-4.4-3.6-8-8-8z'/>
  </svg>
)

export function getArrowLeftIconHtml(props: IconProps = {}) {
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
                <path d="M872 474H286.9l350.2-304c5.6-4.9 2.2-14-5.2-14h-88.5c-3.9 0-7.6 1.4-10.5 3.9L155 487.8a31.96 31.96 0 000 48.3L535.1 866c1.5 1.3 3.3 2 5.2 2h91.5c7.4 0 10.8-9.2 5.2-14L286.9 550H872c4.4 0 8-3.6 8-8v-60c0-4.4-3.6-8-8-8z"/>
            </svg>`
}
