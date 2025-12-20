/**
 * @see https://umijs.org/docs/max/access#access
 * */
import {checkPermissions} from "@/utils/authority";

export default function access(initialState: { currentUser?: UCENTERAPI.UserInfoWithToken } | undefined) {
  const {currentUser} = initialState ?? {};
  return {
    canAdmin: currentUser?.privs?.includes('admin'),
    normalRouteFilter: (route: any) => checkPermissions(route.authority, currentUser?.privs),
  };
}
