drop policy if exists "avatar public read" on storage.objects;
create policy "avatar read" on storage.objects for select to authenticated using(bucket_id='profile-avatars');
