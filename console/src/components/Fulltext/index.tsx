import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import { message } from 'antd'
import { fetchSchedule, groupResultsByType, FulltextScheduleResult } from '@/utils/fulltextSchedule'
import SchedulingModal from './SchedulingModal'
import OALinksModal from './OALinksModal'
import ChannelModal from './ChannelModal'
import DDSApply from './DDSApply'

interface FulltextState {
  scheduling: boolean
  oaLinksOpen: boolean
  channelOpen: boolean
  ddsApplyOpen: boolean
  currentServiceType: 'dd' | 'ill'
  currentTitle: string
  currentDetail: any
  currentOALinks: { href: string; label?: string }[]
  currentPPVLink: string | undefined
}

interface FulltextContextType {
  scheduleFulltext: (resCode: string, detail?: any) => Promise<void>
}

const FulltextContext = createContext<FulltextContextType>({
  scheduleFulltext: async () => {},
})

export const useFulltextSchedule = () => useContext(FulltextContext)

const initialState: FulltextState = {
  scheduling: false,
  oaLinksOpen: false,
  channelOpen: false,
  ddsApplyOpen: false,
  currentServiceType: 'dd',
  currentTitle: '',
  currentDetail: null,
  currentOALinks: [],
  currentPPVLink: undefined,
}

export const FulltextProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<FulltextState>(initialState)

  const closeAll = useCallback(() => {
    setState(initialState)
  }, [])

  const openLink = useCallback((url: string) => {
    window.open(url, '_blank')
  }, [])

  const handleScheduleResult = useCallback(
    (grouped: FulltextScheduleResult, detail?: any) => {
      const title = detail?.title || ''

      if (grouped.lci) {
        if (grouped.lci.links?.length) {
          openLink(grouped.lci.links[0].href)
        }
        return
      }

      if (grouped.original) {
        if (grouped.original.links?.length) {
          openLink(grouped.original.links[0].href)
        }
        return
      }

      if (grouped.oa) {
        const links = grouped.oa.links || []
        if (links.length === 1) {
          openLink(links[0].href)
        } else if (links.length > 1) {
          setState((prev) => ({
            ...prev,
            oaLinksOpen: true,
            currentTitle: title,
            currentOALinks: links,
          }))
        }
        return
      }

      if (grouped.ill) {
        setState((prev) => ({
          ...prev,
          ddsApplyOpen: true,
          currentServiceType: 'ill',
          currentTitle: title,
          currentDetail: detail,
        }))
        return
      }

      if (grouped.dds || grouped.ppv) {
        const ppvLink = grouped.ppv?.links?.[0]?.href
        const hasPPV = !!ppvLink

        if (hasPPV) {
          setState((prev) => ({
            ...prev,
            channelOpen: true,
            currentTitle: title,
            currentDetail: detail,
            currentPPVLink: ppvLink,
          }))
        } else {
          setState((prev) => ({
            ...prev,
            ddsApplyOpen: true,
            currentServiceType: 'dd',
            currentTitle: title,
            currentDetail: detail,
          }))
        }
        return
      }

      message.warning('暂未找到该资源的全文信息，请稍后再试')
    },
    [openLink],
  )

  const scheduleFulltext = useCallback(
    async (resCode: string, detail?: any) => {
      await fetchSchedule(resCode, {
        onScheduling: () => {
          setState((prev) => ({ ...prev, scheduling: true }))
        },
        onScheduled: () => {
          setState((prev) => ({ ...prev, scheduling: false }))
        },
        onResult: (results) => {
          const grouped = groupResultsByType(results)
          handleScheduleResult(grouped, detail)
        },
      })
    },
    [handleScheduleResult],
  )

  const handleDDSApplyClose = useCallback(() => {
    setState((prev) => ({ ...prev, ddsApplyOpen: false }))
  }, [])

  const handleOALinksClose = useCallback(() => {
    setState((prev) => ({ ...prev, oaLinksOpen: false, currentOALinks: [] }))
  }, [])

  const handleChannelClose = useCallback(() => {
    setState((prev) => ({ ...prev, channelOpen: false }))
  }, [])

  const handleDDSApply = useCallback(() => {
    setState((prev) => ({
      ...prev,
      channelOpen: false,
      ddsApplyOpen: true,
    }))
  }, [])

  const handlePPVOpen = useCallback(() => {
    if (state.currentPPVLink) {
      openLink(state.currentPPVLink)
      setState((prev) => ({ ...prev, channelOpen: false }))
    }
  }, [state.currentPPVLink, openLink])

  const contextValue = useRef<FulltextContextType>({ scheduleFulltext })
  contextValue.current = { scheduleFulltext }

  return (
    <FulltextContext.Provider value={contextValue.current}>
      {children}

      <SchedulingModal open={state.scheduling} />

      <OALinksModal
        open={state.oaLinksOpen}
        onClose={handleOALinksClose}
        title={state.currentTitle}
        links={state.currentOALinks}
      />

      <ChannelModal
        open={state.channelOpen}
        onClose={handleChannelClose}
        title={state.currentTitle}
        ppvLink={state.currentPPVLink}
        onDDSApply={handleDDSApply}
        onPPVOpen={handlePPVOpen}
      />

      <DDSApply
        open={state.ddsApplyOpen}
        onClose={handleDDSApplyClose}
        detail={state.currentDetail}
        title={state.currentTitle}
        ddsServiceType={state.currentServiceType}
      />
    </FulltextContext.Provider>
  )
}