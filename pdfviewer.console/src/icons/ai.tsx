import React from 'react'
import {IconProps} from './types'

export const AIIcon = (
  {
    size = 24,
    strokeWidth = 2,
    primaryColor = 'currentColor',
    className,
    title,
  }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox='0 0 1024 1024'
    fill='none'
    stroke={primaryColor}
    strokeWidth={strokeWidth}
    strokeLinecap='round'
    strokeLinejoin='round'
    className={className}
    role='img'
    aria-label={title}
  >
    <path
      d='M374.36328125 204.980469L139.58984375 819.019531h107.52539037l55.89843775-153.93164063h257.13281276l55.89843699 153.98437526h107.578125L488.79687525 204.92773437H374.36328125z m-41.238281 377.57812475L430.261719 313.296875h3.42773412l96.2929685 269.15625025H333.12500025z m450.6679685-377.57812475v614.039062h100.6171875V204.980469h-100.6171875z'
      fill='currentColor'></path>
  </svg>
)

export function getAIIconHtml(props: IconProps = {}) {
  const {
    size = 24,
    strokeWidth = 2,
    primaryColor = 'currentColor',
    className,
    title,
  } = props
  return `<svg
                width='${size}'
                height='${size}'
                viewBox='0 0 1024 1024'
                fill='none'
                stroke='${primaryColor}'
                stroke-width=${strokeWidth}
                stroke-linecap='round'
                stroke-linejoin='round'
                role='img'
                class='${className}'
                aria-label='${title}'
            >
                <path
      d='M374.36328125 204.980469L139.58984375 819.019531h107.52539037l55.89843775-153.93164063h257.13281276l55.89843699 153.98437526h107.578125L488.79687525 204.92773437H374.36328125z m-41.238281 377.57812475L430.261719 313.296875h3.42773412l96.2929685 269.15625025H333.12500025z m450.6679685-377.57812475v614.039062h100.6171875V204.980469h-100.6171875z'
      fill='currentColor'></path>
            </svg>`
}
