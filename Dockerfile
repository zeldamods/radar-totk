FROM node:18
WORKDIR /radar
COPY . .
RUN npm install && npm install typescript -g
RUN apt-get update && apt-get install -y zstd python3-pip && pip3 install sarc byml --break-system-packages
CMD ./node_modules/.bin/ts-node ./build.ts -r /romfs -e ./tools && \
    npm run dev
