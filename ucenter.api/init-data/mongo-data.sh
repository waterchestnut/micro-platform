# 电话字段范围
mongoexport --uri="mongodb://mongo7-124:27017/ucenter-api" -u="localuser" -p="local" -c="mobileRange" -o="mobileRange.json" --authenticationDatabase="admin"
mongoimport --uri="mongodb://mongo-local:37017/ucenter-api" -u="localuser" -p="local" -c="mobileRange" --authenticationDatabase="admin" "mobileRange.json"

# 地区
mongoexport --uri="mongodb://mongo7-124:27017/ucenter-api" -u="localuser" -p="local" -c="region" -o="region.json" --authenticationDatabase="admin"
mongoimport --uri="mongodb://mongo-local:37017/ucenter-api" -u="localuser" -p="local" -c="region" --authenticationDatabase="admin" "region.json"