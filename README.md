## totkradar
A server for querying placement objects in *The Legend of Zelda: Tears of the Kingdom*.

Run build.ts to generate a map database before starting the server for the first time.

    ts-node build.ts -r ../totk -e tools

This assumes the `totk` directory contains the unaltered romfs contents.

For docker usage: `docker build -t radar .; docker run -it --rm --name radar -v /path/to/your/romfs:/romfs radar`

It's possible to build the db within docker and copy it out for the server to use, if you'd rather not install the extraction tools used in build.ts on your local machine.
